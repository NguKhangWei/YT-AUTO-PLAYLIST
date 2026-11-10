// Minimal YouTube Data API v3 client: only the calls the app needs.
import { parseIsoDuration } from '../filter'
import { toYouTubeError, YouTubeApiError } from './errors'
import type { Channel, Playlist, UploadItem, VideoDetails } from './types'

const API = 'https://www.googleapis.com/youtube/v3'
const MAX_UPLOAD_PAGES = 20 // caps one uploads scan at 1,000 videos

interface Thumbnails {
  default?: { url?: string }
  medium?: { url?: string }
}
interface Page<T> {
  items?: T[]
  nextPageToken?: string
}
interface RawChannel {
  id: string
  snippet?: { title?: string; customUrl?: string; thumbnails?: Thumbnails }
  contentDetails?: { relatedPlaylists?: { uploads?: string } }
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean }
}
interface RawPlaylist {
  id: string
  snippet?: { title?: string; thumbnails?: Thumbnails }
  contentDetails?: { itemCount?: number }
}
interface RawPlaylistItem {
  contentDetails?: { videoId?: string; videoPublishedAt?: string }
}
interface RawVideo {
  id: string
  snippet?: {
    title?: string
    channelId?: string
    publishedAt?: string
    liveBroadcastContent?: string
  }
  contentDetails?: { duration?: string }
  liveStreamingDetails?: object
}

type Query = Record<string, string | number | boolean | undefined>

const thumbnail = (t?: Thumbnails) => t?.medium?.url ?? t?.default?.url

/** Maps an API channel; null when it has no uploads playlist. */
function toChannel(raw: RawChannel): Channel | null {
  const uploads = raw.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) return null
  const handle = raw.snippet?.customUrl
  const subs = raw.statistics?.subscriberCount
  return {
    id: raw.id,
    title: raw.snippet?.title ?? raw.id,
    handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : undefined,
    thumbnailUrl: thumbnail(raw.snippet?.thumbnails),
    subscriberCount:
      raw.statistics?.hiddenSubscriberCount || subs === undefined ? undefined : Number(subs),
    uploadsPlaylistId: uploads,
  }
}

function toVideo(raw: RawVideo): VideoDetails {
  const live = raw.snippet?.liveBroadcastContent
  return {
    id: raw.id,
    title: raw.snippet?.title ?? raw.id,
    channelId: raw.snippet?.channelId ?? '',
    publishedAt: new Date(raw.snippet?.publishedAt ?? 0),
    durationSeconds: parseIsoDuration(raw.contentDetails?.duration ?? 'P0D'),
    liveBroadcastContent: live === 'live' || live === 'upcoming' ? live : 'none',
    hasLiveStreamingDetails: raw.liveStreamingDetails !== undefined,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Creates a client that authenticates with `getAccessToken`. On a 401 it asks
 * for a refreshed token and retries once.
 */
export function createYouTubeClient(opts: {
  getAccessToken: (o?: { forceRefresh?: boolean }) => Promise<string>
}) {
  async function request<T>(
    path: string,
    query: Query,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${API}/${path}`)
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    const send = async (forceRefresh: boolean) => {
      const token = await opts.getAccessToken({ forceRefresh })
      try {
        return await fetch(url, {
          method: init.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        })
      } catch (e) {
        throw new YouTubeApiError('network', `Network error calling ${path}: ${String(e)}`)
      }
    }

    let res = await send(false)
    if (res.status === 401) res = await send(true)
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) throw toYouTubeError(res.status, body)
    return body as T
  }

  /** Every item of a paginated list. */
  async function listAll<T>(path: string, query: Query): Promise<T[]> {
    const items: T[] = []
    let pageToken: string | undefined
    do {
      const page = await request<Page<T>>(path, { ...query, maxResults: 50, pageToken })
      items.push(...(page.items ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return items
  }

  async function getChannels(
    by: { ids: string[] } | { forHandle: string } | { forUsername: string },
  ): Promise<Channel[]> {
    const part = 'snippet,contentDetails,statistics'
    const batches = 'ids' in by ? chunk(by.ids, 50).map((ids) => ({ id: ids.join(',') })) : [by]
    const channels: Channel[] = []
    for (const query of batches) {
      const page = await request<Page<RawChannel>>('channels', { part, maxResults: 50, ...query })
      for (const raw of page.items ?? []) {
        const channel = toChannel(raw)
        if (channel) channels.push(channel)
      }
    }
    return channels
  }

  return {
    getChannels,

    /** Channels matching `q`, in search order (costs 100 quota units). */
    async searchChannels(q: string, maxResults = 5): Promise<Channel[]> {
      const page = await request<Page<{ id?: { channelId?: string } }>>('search', {
        part: 'snippet',
        type: 'channel',
        q,
        maxResults,
      })
      const ids = (page.items ?? []).map((r) => r.id?.channelId).filter((id) => id !== undefined)
      if (ids.length === 0) return []
      const byId = new Map((await getChannels({ ids })).map((c) => [c.id, c]))
      return ids.map((id) => byId.get(id)).filter((c) => c !== undefined)
    },

    /** All playlists owned by the signed-in user. */
    async listMyPlaylists(): Promise<Playlist[]> {
      const raw = await listAll<RawPlaylist>('playlists', {
        part: 'snippet,contentDetails',
        mine: true,
      })
      return raw.map((p) => ({
        id: p.id,
        title: p.snippet?.title ?? p.id,
        itemCount: p.contentDetails?.itemCount ?? 0,
        thumbnailUrl: thumbnail(p.snippet?.thumbnails),
      }))
    },

    /**
     * Uploads published at or after `since`, newest first. Stops after the
     * first page that reaches older videos; skips private or deleted entries.
     */
    async listUploadsSince(uploadsPlaylistId: string, since: Date): Promise<UploadItem[]> {
      const uploads: UploadItem[] = []
      let pageToken: string | undefined
      for (let page = 0; page < MAX_UPLOAD_PAGES; page++) {
        const res = await request<Page<RawPlaylistItem>>('playlistItems', {
          part: 'contentDetails',
          playlistId: uploadsPlaylistId,
          maxResults: 50,
          pageToken,
        })
        let reachedOlder = false
        for (const item of res.items ?? []) {
          const { videoId, videoPublishedAt } = item.contentDetails ?? {}
          if (!videoId || !videoPublishedAt) continue
          const publishedAt = new Date(videoPublishedAt)
          if (publishedAt >= since) uploads.push({ videoId, publishedAt })
          else reachedOlder = true
        }
        pageToken = res.nextPageToken
        if (reachedOlder || !pageToken) break
      }
      return uploads
    },

    /** Ids of every video currently in a playlist. */
    async listPlaylistVideoIds(playlistId: string): Promise<Set<string>> {
      const items = await listAll<RawPlaylistItem>('playlistItems', {
        part: 'contentDetails',
        playlistId,
      })
      return new Set(items.map((i) => i.contentDetails?.videoId).filter((id) => id !== undefined))
    },

    /** Details for the given videos; deleted or private ones are missing from the result. */
    async getVideos(ids: string[]): Promise<VideoDetails[]> {
      const videos: VideoDetails[] = []
      for (const batch of chunk(ids, 50)) {
        const page = await request<Page<RawVideo>>('videos', {
          part: 'snippet,contentDetails,liveStreamingDetails',
          id: batch.join(','),
          maxResults: 50,
        })
        videos.push(...(page.items ?? []).map(toVideo))
      }
      return videos
    },

    /** Appends a video to a playlist (costs 50 quota units). */
    async insertPlaylistItem(playlistId: string, videoId: string): Promise<void> {
      await request(
        'playlistItems',
        { part: 'snippet' },
        {
          method: 'POST',
          body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
        },
      )
    },
  }
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>

/**
 * True if YouTube serves the video as a Short: `/shorts/{id}` answers 200 for
 * Shorts and redirects regular videos. Costs no quota; false if offline.
 */
export async function isShortVideo(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`, {
      method: 'HEAD',
      redirect: 'manual',
    })
    return res.status === 200
  } catch {
    return false
  }
}
