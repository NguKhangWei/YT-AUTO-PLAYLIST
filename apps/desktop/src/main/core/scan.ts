// One scan: find a scheduler's new regular uploads and append them to its playlist.
import type { SqliteStorage } from '../db/sqlite-storage'
import { filterRegularVideos } from './filter'
import type { YouTubeClient } from './youtube/client'
import { YouTubeApiError } from './youtube/errors'
import type { Channel, SkipReason, VideoDetails } from './youtube/types'

const OVERLAP_MS = 24 * 60 * 60 * 1000 // re-read the last day to catch late-listed uploads

export interface ScanDeps {
  storage: Pick<
    SqliteStorage,
    | 'getScheduler'
    | 'listTrackedChannels'
    | 'listHandledVideoIds'
    | 'recordHandledVideo'
    | 'setLastSuccessAt'
    | 'setActive'
  >
  client: Pick<
    YouTubeClient,
    'listUploadsSince' | 'getVideos' | 'listPlaylistVideoIds' | 'insertPlaylistItem'
  >
  isShort: (videoId: string) => Promise<boolean>
  now: () => Date
}

export interface ScanResult {
  status: 'ok' | 'partial' | 'error'
  startedAt: Date
  finishedAt: Date
  added: VideoDetails[] // oldest first
  skipped: { videoId: string; title?: string; reason: SkipReason }[]
  unavailableChannels: Channel[] // deleted or terminated channels
  error?: { kind: string; message: string }
  deactivated: boolean // turned off because the playlist is gone
}

/**
 * Scans one scheduler. Every handled video is recorded straight away, so a
 * crash or quota stop never causes duplicates, and `lastSuccessAt` only moves
 * on a complete scan, so leftovers are picked up next time. A deleted target
 * playlist turns the scheduler off. Non-API errors are rethrown.
 */
export async function runScan(schedulerId: string, deps: ScanDeps): Promise<ScanResult> {
  const { storage, client } = deps
  const startedAt = deps.now()
  const result: ScanResult = {
    status: 'ok',
    startedAt,
    finishedAt: startedAt,
    added: [],
    skipped: [],
    unavailableChannels: [],
    deactivated: false,
  }
  const finish = (): ScanResult => ({ ...result, finishedAt: deps.now() })

  const scheduler = storage.getScheduler(schedulerId)
  if (!scheduler) {
    result.status = 'error'
    result.error = { kind: 'schedulerNotFound', message: `Scheduler ${schedulerId} not found.` }
    return finish()
  }
  const remember = (videoId: string) => storage.recordHandledVideo(schedulerId, videoId, startedAt)

  try {
    const handled = storage.listHandledVideoIds(schedulerId)
    const overlapFrom = scheduler.lastSuccessAt
      ? scheduler.lastSuccessAt.getTime() - OVERLAP_MS
      : -Infinity
    const candidates = new Set<string>()
    for (const { channel, sinceAt } of storage.listTrackedChannels(schedulerId)) {
      const cursor = new Date(Math.max(sinceAt.getTime(), overlapFrom))
      try {
        for (const { videoId } of await client.listUploadsSince(
          channel.uploadsPlaylistId,
          cursor,
        )) {
          if (!handled.has(videoId)) candidates.add(videoId)
        }
      } catch (e) {
        const gone =
          e instanceof YouTubeApiError && ['playlistNotFound', 'notFound'].includes(e.kind)
        if (!gone) throw e
        result.unavailableChannels.push(channel)
      }
    }

    if (candidates.size > 0) {
      const details = await client.getVideos([...candidates])
      const found = new Set(details.map((v) => v.id))
      for (const id of candidates) {
        if (!found.has(id)) result.skipped.push({ videoId: id, reason: 'unavailable' }) // retried later
      }
      const { regular, skipped } = await filterRegularVideos(details, deps.isShort)
      for (const { video, reason } of skipped) {
        result.skipped.push({ videoId: video.id, title: video.title, reason })
        remember(video.id) // Shorts and streams never become regular videos
      }

      if (regular.length > 0) {
        const inPlaylist = await client.listPlaylistVideoIds(scheduler.playlistId)
        const toAdd = regular
          .filter((v) => {
            if (!inPlaylist.has(v.id)) return true
            result.skipped.push({ videoId: v.id, title: v.title, reason: 'inPlaylist' })
            remember(v.id)
            return false
          })
          .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())

        for (const video of toAdd) {
          try {
            await client.insertPlaylistItem(scheduler.playlistId, video.id)
          } catch (e) {
            if (!(e instanceof YouTubeApiError && e.kind === 'videoNotFound')) throw e
            result.skipped.push({ videoId: video.id, title: video.title, reason: 'unavailable' })
            continue
          }
          storage.recordHandledVideo(schedulerId, video.id, deps.now())
          result.added.push(video)
        }
      }
    }
    storage.setLastSuccessAt(schedulerId, startedAt)
    return finish()
  } catch (e) {
    if (!(e instanceof YouTubeApiError)) throw e
    result.status = result.added.length > 0 ? 'partial' : 'error'
    result.error = { kind: e.kind, message: e.message }
    if (e.kind === 'playlistNotFound') {
      result.status = 'error'
      result.deactivated = true
      storage.setActive(schedulerId, false)
    }
    return finish()
  }
}
