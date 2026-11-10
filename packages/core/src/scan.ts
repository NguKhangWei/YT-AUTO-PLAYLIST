import { filterRegularVideos, type SkipReason } from './filter'
import type { ScanStorage } from './ports'
import type { YouTubeClient } from './youtube/client'
import { YouTubeApiError, type YouTubeErrorKind } from './youtube/errors'
import { QUOTA_COSTS } from './youtube/quota'
import type { Channel, VideoDetails } from './youtube/types'

/** Re-scan this far before the last successful scan, to catch late-indexed uploads. Dedupe makes it free of duplicates. */
export const OVERLAP_MS = 24 * 60 * 60 * 1000

export interface ScanDeps {
  storage: ScanStorage
  client: Pick<
    YouTubeClient,
    'listUploadsSince' | 'getVideos' | 'listPlaylistVideoIds' | 'insertPlaylistItem'
  >
  /** Shorts probe (see `isShortVideo`). */
  isShort: (videoId: string) => Promise<boolean>
  now: () => Date
  /** Units left today, if known. Used only to warn; the API is the real authority. */
  quotaRemaining?: () => number
}

export type ScanStatus =
  /** Finished; every new video was added. */
  | 'ok'
  /** Stopped part-way (e.g. quota). Some videos may have been added; the rest are retried next scan. */
  | 'partial'
  /** Nothing could be done (e.g. signed out, playlist gone). */
  | 'error'

export type ScanSkipReason =
  | SkipReason
  /** Already in the target playlist (e.g. added by hand). */
  | 'inPlaylist'
  /** Deleted or made private before it could be added. */
  | 'unavailable'

export interface ScanResult {
  schedulerId: string
  status: ScanStatus
  startedAt: Date
  finishedAt: Date
  /** Added to the playlist, oldest first. */
  added: VideoDetails[]
  skipped: { videoId: string; title?: string; reason: ScanSkipReason }[]
  /** Channels whose uploads couldn't be read (deleted or terminated). They don't block success. */
  unavailableChannels: Channel[]
  /** Set when status isn't 'ok'. */
  error?: { kind: YouTubeErrorKind | 'schedulerNotFound'; message: string }
  /** The scheduler was turned off because its playlist no longer exists. */
  deactivated: boolean
  /** The local quota estimate said there wasn't enough left for all inserts. */
  quotaWarning: boolean
}

/**
 * Scan one scheduler: find new regular uploads of its channels and append them
 * to its playlist, oldest first.
 *
 * - "New" = published at/after the channel's `sinceAt` and after
 *   `lastSuccessAt − 24 h`, and not already handled by this scheduler.
 * - Videos already in the playlist are skipped and remembered.
 * - Each added video is recorded immediately, so a crash or quota stop never
 *   causes duplicates on the next scan.
 * - `lastSuccessAt` only moves forward when everything succeeded, so videos
 *   left over by a partial scan are picked up next time.
 * - A deleted target playlist turns the scheduler off.
 */
export async function runScan(schedulerId: string, deps: ScanDeps): Promise<ScanResult> {
  const { storage, client } = deps
  const startedAt = deps.now()
  const result: ScanResult = {
    schedulerId,
    status: 'ok',
    startedAt,
    finishedAt: startedAt,
    added: [],
    skipped: [],
    unavailableChannels: [],
    deactivated: false,
    quotaWarning: false,
  }
  const finish = (): ScanResult => ({ ...result, finishedAt: deps.now() })
  const fail = async (e: unknown): Promise<ScanResult> => {
    if (!(e instanceof YouTubeApiError)) throw e
    result.status = result.added.length > 0 ? 'partial' : 'error'
    result.error = { kind: e.kind, message: e.message }
    if (e.kind === 'playlistNotFound') {
      result.status = 'error'
      result.deactivated = true
      await storage.setActive(schedulerId, false)
    }
    return finish()
  }

  const scheduler = await storage.getScheduler(schedulerId)
  if (!scheduler) {
    result.status = 'error'
    result.error = { kind: 'schedulerNotFound', message: `Scheduler ${schedulerId} not found.` }
    return finish()
  }

  try {
    // 1. Candidate uploads from every tracked channel.
    const tracked = await storage.listTrackedChannels(schedulerId)
    const handled = await storage.listAddedVideoIds(schedulerId)
    const overlapFrom = scheduler.lastSuccessAt
      ? scheduler.lastSuccessAt.getTime() - OVERLAP_MS
      : -Infinity
    const candidateIds: string[] = []
    const seen = new Set<string>()
    for (const { channel, sinceAt } of tracked) {
      const cursor = new Date(Math.max(sinceAt.getTime(), overlapFrom))
      let uploads
      try {
        uploads = await client.listUploadsSince(channel.uploadsPlaylistId, cursor)
      } catch (e) {
        // A missing uploads playlist means the channel is gone; keep scanning the others.
        if (
          e instanceof YouTubeApiError &&
          (e.kind === 'playlistNotFound' || e.kind === 'notFound')
        ) {
          result.unavailableChannels.push(channel)
          continue
        }
        throw e
      }
      for (const { videoId } of uploads) {
        if (handled.has(videoId) || seen.has(videoId)) continue
        seen.add(videoId)
        candidateIds.push(videoId)
      }
    }
    if (candidateIds.length === 0) return await succeed()

    // 2. Keep regular videos only. Ids missing from videos.list were deleted or made private.
    const details = await client.getVideos(candidateIds)
    const found = new Set(details.map((v) => v.id))
    for (const id of candidateIds) {
      if (!found.has(id)) result.skipped.push({ videoId: id, reason: 'unavailable' })
    }
    const { regular, skipped } = await filterRegularVideos(details, deps.isShort)
    for (const s of skipped) {
      result.skipped.push({ videoId: s.video.id, title: s.video.title, reason: s.reason })
      // Shorts/streams never become regular, so don't re-check them every scan.
      await storage.recordAddedVideo(schedulerId, s.video.id, startedAt)
    }
    if (regular.length === 0) return await succeed()

    // 3. Skip what's already in the playlist (e.g. added by hand), and remember it.
    const inPlaylist = await client.listPlaylistVideoIds(scheduler.playlistId)
    const toAdd: VideoDetails[] = []
    for (const v of regular) {
      if (inPlaylist.has(v.id)) {
        result.skipped.push({ videoId: v.id, title: v.title, reason: 'inPlaylist' })
        await storage.recordAddedVideo(schedulerId, v.id, startedAt)
      } else {
        toAdd.push(v)
      }
    }
    toAdd.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())

    const needed = toAdd.length * QUOTA_COSTS['playlistItems.insert']
    if (deps.quotaRemaining && needed > deps.quotaRemaining()) result.quotaWarning = true

    // 4. Append oldest first, recording each one as soon as it's in.
    for (const v of toAdd) {
      try {
        await client.insertPlaylistItem(scheduler.playlistId, v.id)
      } catch (e) {
        // A video removed since we listed it only affects itself; any other error ends the scan.
        if (e instanceof YouTubeApiError && e.kind === 'videoNotFound') {
          result.skipped.push({ videoId: v.id, title: v.title, reason: 'unavailable' })
          continue
        }
        throw e
      }
      await storage.recordAddedVideo(schedulerId, v.id, deps.now())
      result.added.push(v)
    }
    return await succeed()
  } catch (e) {
    return await fail(e)
  }

  async function succeed(): Promise<ScanResult> {
    await storage.setLastSuccessAt(schedulerId, startedAt)
    return finish()
  }
}
