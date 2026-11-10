import { parseIsoDuration } from '../filter'
import { toYouTubeError, YouTubeApiError } from './errors'
import { QUOTA_COSTS, type ApiMethod } from './quota'
import type { Channel, Playlist, UploadItem, VideoDetails } from './types'

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

export interface YouTubeClientOptions {
  /**
   * Returns a valid OAuth access token. Called with `forceRefresh` after a 401
   * so the provider can refresh an expired token. It should throw
   * `YouTubeApiError('unauthorized', …)` when the refresh token is revoked.
   */
  getAccessToken: (opts?: { forceRefresh?: boolean }) => Promise<string>
  /** Called once per API request sent, with the quota units it costs. */
  onQuota?: (units: number, method: ApiMethod) => void
  /** Injectable for tests and other runtimes. Defaults to global fetch. */
  fetch?: typeof fetch
  baseUrl?: string
}

/** Upper bound on pages read per uploads scan (50 videos each), to cap quota use. */
export const MAX_UPLOAD_PAGES = 20

// --- Raw API shapes (only the fields we read) ---
interface Thumbnails {
  default?: { url?: string }
  medium?: { url?: string }
}
interface ListResponse<T> {
  items?: T[]
  nextPageToken?: string
}
interface RawChannel {
  id: string
  snippet?: { title?: string; customUrl?: string; thumbnails?: Thumbnails }
  contentDetails?: { relatedPlaylists?: { uploads?: string } }
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean }
}
interface RawSearchResult {
  id?: { channelId?: string }
  snippet?: { channelId?: string }
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

function toChannel(raw: RawChannel): Channel | null {
  const uploads = raw.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) return null
  const handle = raw.snippet?.customUrl
  const subs = raw.statistics?.subscriberCount
  return {
    id: raw.id,
    title: raw.snippet?.title ?? raw.id,
    handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : undefined,
    thumbnailUrl: raw.snippet?.thumbnails?.medium?.url ?? raw.snippet?.thumbnails?.default?.url,
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
 * Thin YouTube Data API v3 client over `fetch`. Uses only web-standard APIs so
 * it runs in Electron's main process today and a Cloudflare Worker later.
 */
export function createYouTubeClient(opts: YouTubeClientOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const base = opts.baseUrl ?? YOUTUBE_API_BASE

  async function request<T>(
    method: ApiMethod,
    path: string,
    query: Query,
    init: { httpMethod?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${base}/${path}`)
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }

    const send = async (forceRefresh: boolean): Promise<Response> => {
      const token = await opts.getAccessToken({ forceRefresh })
      opts.onQuota?.(QUOTA_COSTS[method], method)
      try {
        return await doFetch(url, {
          method: init.httpMethod ?? 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        })
      } catch (e) {
        throw new YouTubeApiError('network', `Network error calling ${method}: ${String(e)}`)
      }
    }

    let res = await send(false)
    if (res.status === 401) res = await send(true) // access token expired: refresh once
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) throw toYouTubeError(res.status, body)
    return body as T
  }

  async function getChannels(
    by: { ids: string[] } | { forHandle: string } | { forUsername: string },
  ): Promise<Channel[]> {
    const part = 'snippet,contentDetails,statistics'
    if ('ids' in by) {
      const results: Channel[] = []
      for (const ids of chunk(by.ids, 50)) {
        const res = await request<ListResponse<RawChannel>>('channels.list', 'channels', {
          part,
          id: ids.join(','),
          maxResults: 50,
        })
        for (const raw of res.items ?? []) {
          const c = toChannel(raw)
          if (c) results.push(c)
        }
      }
      return results
    }
    const res = await request<ListResponse<RawChannel>>('channels.list', 'channels', {
      part,
      ...by,
    })
    return (res.items ?? []).map(toChannel).filter((c): c is Channel => c !== null)
  }

  return {
    getChannels,

    /** Search channels by name (100 units + 1 for details). Results keep search order. */
    async searchChannels(q: string, maxResults = 5): Promise<Channel[]> {
      const res = await request<ListResponse<RawSearchResult>>('search.list', 'search', {
        part: 'snippet',
        type: 'channel',
        q,
        maxResults,
      })
      const ids = (res.items ?? [])
        .map((r) => r.id?.channelId ?? r.snippet?.channelId)
        .filter((id): id is string => !!id)
      if (ids.length === 0) return []
      const byId = new Map((await getChannels({ ids })).map((c) => [c.id, c]))
      return ids.map((id) => byId.get(id)).filter((c): c is Channel => c !== undefined)
    },

    /** All playlists owned by the signed-in user. */
    async listMyPlaylists(): Promise<Playlist[]> {
      const out: Playlist[] = []
      let pageToken: string | undefined
      do {
        const res = await request<ListResponse<RawPlaylist>>('playlists.list', 'playlists', {
          part: 'snippet,contentDetails',
          mine: true,
          maxResults: 50,
          pageToken,
        })
        for (const p of res.items ?? []) {
          out.push({
            id: p.id,
            title: p.snippet?.title ?? p.id,
            itemCount: p.contentDetails?.itemCount ?? 0,
            thumbnailUrl: p.snippet?.thumbnails?.medium?.url ?? p.snippet?.thumbnails?.default?.url,
          })
        }
        pageToken = res.nextPageToken
      } while (pageToken)
      return out
    },

    /**
     * Uploads published at or after `since`, newest first. Reads the uploads
     * playlist page by page and stops after the first page reaching older
     * videos (or after MAX_UPLOAD_PAGES). Private/deleted entries are skipped.
     */
    async listUploadsSince(uploadsPlaylistId: string, since: Date): Promise<UploadItem[]> {
      const out: UploadItem[] = []
      let pageToken: string | undefined
      for (let page = 0; page < MAX_UPLOAD_PAGES; page++) {
        const res = await request<ListResponse<RawPlaylistItem>>(
          'playlistItems.list',
          'playlistItems',
          { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: 50, pageToken },
        )
        let reachedOlder = false
        for (const item of res.items ?? []) {
          const videoId = item.contentDetails?.videoId
          const at = item.contentDetails?.videoPublishedAt
          if (!videoId || !at) continue
          const publishedAt = new Date(at)
          if (publishedAt.getTime() >= since.getTime()) out.push({ videoId, publishedAt })
          else reachedOlder = true
        }
        pageToken = res.nextPageToken
        if (reachedOlder || !pageToken) break
      }
      return out
    },

    /** Every video id currently in a playlist (1 unit per 50 items). */
    async listPlaylistVideoIds(playlistId: string): Promise<Set<string>> {
      const ids = new Set<string>()
      let pageToken: string | undefined
      do {
        const res = await request<ListResponse<RawPlaylistItem>>(
          'playlistItems.list',
          'playlistItems',
          { part: 'contentDetails', playlistId, maxResults: 50, pageToken },
        )
        for (const item of res.items ?? []) {
          if (item.contentDetails?.videoId) ids.add(item.contentDetails.videoId)
        }
        pageToken = res.nextPageToken
      } while (pageToken)
      return ids
    },

    /** Details for videos, 50 per request. Deleted/private videos are absent from the result. */
    async getVideos(ids: string[]): Promise<VideoDetails[]> {
      const out: VideoDetails[] = []
      for (const batch of chunk(ids, 50)) {
        const res = await request<ListResponse<RawVideo>>('videos.list', 'videos', {
          part: 'snippet,contentDetails,liveStreamingDetails',
          id: batch.join(','),
          maxResults: 50,
        })
        out.push(...(res.items ?? []).map(toVideo))
      }
      return out
    },

    /** Append a video to the end of a playlist (50 units). */
    async insertPlaylistItem(playlistId: string, videoId: string): Promise<void> {
      await request(
        'playlistItems.insert',
        'playlistItems',
        { part: 'snippet' },
        {
          httpMethod: 'POST',
          body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
        },
      )
    },
  }
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>

/**
 * True if YouTube serves `videoId` as a Short: `/shorts/{id}` answers 200 for
 * Shorts and redirects (3xx) to `/watch` for regular videos. Free (no API
 * quota). On network failure it returns false, so the video is treated as
 * regular rather than silently dropped.
 */
export async function isShortVideo(
  videoId: string,
  doFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<boolean> {
  try {
    const res = await doFetch(`https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`, {
      method: 'HEAD',
      redirect: 'manual',
    })
    return res.status === 200
  } catch {
    return false
  }
}
