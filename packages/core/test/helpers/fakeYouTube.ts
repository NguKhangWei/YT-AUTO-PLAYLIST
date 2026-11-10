import { YouTubeApiError, type YouTubeErrorKind } from '../../src'
import type { ScanDeps } from '../../src'
import type { UploadItem, VideoDetails } from '../../src'

export interface FakeVideo {
  id: string
  channelUploads: string
  publishedAt: string
  durationSeconds?: number
  short?: boolean
  live?: 'none' | 'live' | 'upcoming'
  stream?: boolean
  /** Listed in uploads but missing from videos.list (private/deleted). */
  hidden?: boolean
}

/**
 * An in-memory YouTube with just the calls the scan uses. Playlists hold video
 * ids in insertion order. `queueInsertResults` / `failOn` inject API errors.
 */
export function fakeYouTube(videos: FakeVideo[], playlists: Record<string, string[]> = {}) {
  const lists = new Map(Object.entries(playlists).map(([k, v]) => [k, [...v]]))
  const goneUploads = new Set<string>()
  const insertErrors: (YouTubeErrorKind | undefined)[] = []
  const failOn: Partial<
    Record<'listUploadsSince' | 'getVideos' | 'listPlaylistVideoIds', YouTubeErrorKind>
  > = {}
  const calls = {
    listUploadsSince: [] as { playlistId: string; since: Date }[],
    probes: [] as string[],
    inserts: 0,
  }

  const byId = new Map(videos.map((v) => [v.id, v]))
  const err = (kind: YouTubeErrorKind) => new YouTubeApiError(kind, `fake ${kind}`)

  const client: ScanDeps['client'] = {
    async listUploadsSince(playlistId, since) {
      calls.listUploadsSince.push({ playlistId, since })
      if (failOn.listUploadsSince) throw err(failOn.listUploadsSince)
      if (goneUploads.has(playlistId)) throw err('playlistNotFound')
      return videos
        .filter((v) => v.channelUploads === playlistId && new Date(v.publishedAt) >= since)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .map((v): UploadItem => ({ videoId: v.id, publishedAt: new Date(v.publishedAt) }))
    },
    async getVideos(ids) {
      if (failOn.getVideos) throw err(failOn.getVideos)
      return ids
        .map((id) => byId.get(id))
        .filter((v): v is FakeVideo => !!v && !v.hidden)
        .map((v): VideoDetails => ({
          id: v.id,
          title: `Title ${v.id}`,
          channelId: v.channelUploads.replace(/^UU/, 'UC'),
          publishedAt: new Date(v.publishedAt),
          durationSeconds: v.durationSeconds ?? (v.short ? 30 : 600),
          liveBroadcastContent: v.live ?? 'none',
          hasLiveStreamingDetails: !!v.stream || (v.live ?? 'none') !== 'none',
        }))
    },
    async listPlaylistVideoIds(playlistId) {
      if (failOn.listPlaylistVideoIds) throw err(failOn.listPlaylistVideoIds)
      const list = lists.get(playlistId)
      if (!list) throw err('playlistNotFound')
      return new Set(list)
    },
    async insertPlaylistItem(playlistId, videoId) {
      calls.inserts++
      const injected = insertErrors.shift()
      if (injected) throw err(injected)
      const list = lists.get(playlistId)
      if (!list) throw err('playlistNotFound')
      list.push(videoId)
    },
  }

  return {
    client,
    isShort: async (id: string) => {
      calls.probes.push(id)
      return !!byId.get(id)?.short
    },
    calls,
    playlist: (id: string) => lists.get(id),
    deletePlaylist: (id: string) => lists.delete(id),
    addToPlaylist: (id: string, videoId: string) => lists.get(id)?.push(videoId),
    removeUploads: (uploadsId: string) => goneUploads.add(uploadsId),
    /** Queue results for the next inserts: an error kind fails that insert, undefined lets it through. */
    queueInsertResults: (...kinds: (YouTubeErrorKind | undefined)[]) => insertErrors.push(...kinds),
    failOn,
  }
}
