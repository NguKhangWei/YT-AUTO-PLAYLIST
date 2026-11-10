import { describe, expect, it, vi } from 'vitest'
import {
  googleError,
  rawChannel,
  stubFetch,
  type FakeReply,
  type RecordedRequest,
} from '../../test/fakeFetch'
import { createYouTubeClient, isShortVideo } from './client'
import { YouTubeApiError } from './errors'

function setup(handler: (req: RecordedRequest, i: number) => FakeReply) {
  const requests = stubFetch(handler)
  const getAccessToken = vi.fn(async (opts?: { forceRefresh?: boolean }) =>
    opts?.forceRefresh ? 'fresh-token' : 'token',
  )
  return { client: createYouTubeClient({ getAccessToken }), requests, getAccessToken }
}

const ids = (n: number, prefix = 'v') => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe('requests', () => {
  it('sends the bearer token and JSON accept header to the v3 API', async () => {
    const { client, requests } = setup(() => ({ body: { items: [] } }))
    await client.getChannels({ forHandle: '@mkbhd' })
    const [req] = requests
    expect(req?.url.origin + req!.url.pathname).toBe(
      'https://www.googleapis.com/youtube/v3/channels',
    )
    expect(req?.url.searchParams.get('forHandle')).toBe('@mkbhd')
    expect(req?.url.searchParams.get('part')).toBe('snippet,contentDetails,statistics')
    expect(req?.headers['authorization']).toBe('Bearer token')
    expect(req?.headers['accept']).toBe('application/json')
  })
})

describe('searchChannels', () => {
  it('searches channels, then fetches their details, keeping search order', async () => {
    const { client, requests } = setup((req) =>
      req.url.pathname.endsWith('/search')
        ? { body: { items: [{ id: { channelId: 'UCb' } }, { id: { channelId: 'UCa' } }] } }
        : { body: { items: [rawChannel('UCa'), rawChannel('UCb')] } },
    )
    const channels = await client.searchChannels('tech', 5)

    expect(requests[0]?.url.searchParams.get('type')).toBe('channel')
    expect(requests[0]?.url.searchParams.get('q')).toBe('tech')
    expect(requests[0]?.url.searchParams.get('maxResults')).toBe('5')
    expect(requests[1]?.url.searchParams.get('id')).toBe('UCb,UCa')
    expect(channels.map((c) => c.id)).toEqual(['UCb', 'UCa'])
    expect(channels[0]).toEqual({
      id: 'UCb',
      title: 'Channel UCb',
      handle: '@ucb',
      thumbnailUrl: 'https://yt3.ggpht.com/UCb-m',
      subscriberCount: 1234,
      uploadsPlaylistId: 'UUb',
    })
  })

  it('skips the details call when nothing matches', async () => {
    const { client, requests } = setup(() => ({ body: { items: [] } }))
    expect(await client.searchChannels('zzzz')).toEqual([])
    expect(requests).toHaveLength(1)
  })
})

describe('getChannels', () => {
  it('normalises handles, hides hidden subscriber counts, drops channels without uploads', async () => {
    const { client } = setup(() => ({
      body: {
        items: [
          rawChannel('UCa', {
            snippet: { title: 'A', customUrl: 'nohandleprefix' },
            statistics: { subscriberCount: '0', hiddenSubscriberCount: true },
          }),
          rawChannel('UCb', { contentDetails: {} }),
        ],
      },
    }))
    const [a, ...rest] = await client.getChannels({ ids: ['UCa', 'UCb'] })
    expect(rest).toEqual([])
    expect(a).toMatchObject({ handle: '@nohandleprefix', subscriberCount: undefined })
    expect(a?.thumbnailUrl).toBeUndefined()
  })

  it('batches ids 50 per request', async () => {
    const { client, requests } = setup(() => ({ body: { items: [] } }))
    await client.getChannels({ ids: ids(60, 'UC') })
    expect(requests.map((r) => r.url.searchParams.get('id')!.split(',').length)).toEqual([50, 10])
  })
})

describe('listMyPlaylists', () => {
  it('follows page tokens and maps playlists', async () => {
    const { client, requests } = setup((req) =>
      req.url.searchParams.get('pageToken') === 'p2'
        ? { body: { items: [{ id: 'PL2', snippet: { title: 'Two' } }] } }
        : {
            body: {
              items: [{ id: 'PL1', snippet: { title: 'One' }, contentDetails: { itemCount: 7 } }],
              nextPageToken: 'p2',
            },
          },
    )
    expect(await client.listMyPlaylists()).toEqual([
      { id: 'PL1', title: 'One', itemCount: 7, thumbnailUrl: undefined },
      { id: 'PL2', title: 'Two', itemCount: 0, thumbnailUrl: undefined },
    ])
    expect(requests[0]?.url.searchParams.get('mine')).toBe('true')
    expect(requests).toHaveLength(2)
  })
})

describe('listUploadsSince', () => {
  const item = (videoId: string, at?: string) => ({
    contentDetails: { videoId, ...(at ? { videoPublishedAt: at } : {}) },
  })
  const since = new Date('2026-11-01T00:00:00Z')

  it('collects uploads at/after `since` and stops after the page reaching older ones', async () => {
    const { client, requests } = setup((_req, i) => {
      if (i === 0)
        return {
          body: {
            items: [item('new2', '2026-11-05T00:00:00Z'), item('private-no-date')],
            nextPageToken: 'p2',
          },
        }
      if (i === 1)
        return {
          body: {
            items: [item('edge', '2026-11-01T00:00:00Z'), item('old', '2026-10-30T00:00:00Z')],
            nextPageToken: 'p3',
          },
        }
      throw new Error('should not request page 3')
    })
    const uploads = await client.listUploadsSince('UUx', since)
    expect(uploads.map((u) => u.videoId)).toEqual(['new2', 'edge'])
    expect(uploads[0]?.publishedAt).toEqual(new Date('2026-11-05T00:00:00Z'))
    expect(requests[0]?.url.searchParams.get('playlistId')).toBe('UUx')
    expect(requests[1]?.url.searchParams.get('pageToken')).toBe('p2')
    expect(requests).toHaveLength(2)
  })

  it('reads at most 20 pages', async () => {
    const { client, requests } = setup(() => ({
      body: { items: [item('x', '2026-11-05T00:00:00Z')], nextPageToken: 'more' },
    }))
    await client.listUploadsSince('UUx', since)
    expect(requests).toHaveLength(20)
  })
})

describe('listPlaylistVideoIds', () => {
  it('returns every video id across pages', async () => {
    const { client } = setup((_req, i) =>
      i === 0
        ? { body: { items: [{ contentDetails: { videoId: 'a' } }], nextPageToken: 't' } }
        : { body: { items: [{ contentDetails: { videoId: 'b' } }, { contentDetails: {} }] } },
    )
    expect(await client.listPlaylistVideoIds('PL1')).toEqual(new Set(['a', 'b']))
  })
})

describe('getVideos', () => {
  it('maps video fields and batches 50 per request', async () => {
    const { client, requests } = setup((_req, i) =>
      i === 0
        ? {
            body: {
              items: [
                {
                  id: 'v0',
                  snippet: {
                    title: 'Hello',
                    channelId: 'UCa',
                    publishedAt: '2026-11-05T10:00:00Z',
                    liveBroadcastContent: 'none',
                  },
                  contentDetails: { duration: 'PT12M3S' },
                },
                {
                  id: 'v1',
                  snippet: { liveBroadcastContent: 'upcoming' },
                  contentDetails: { duration: 'P0D' },
                  liveStreamingDetails: { scheduledStartTime: '2026-12-01T00:00:00Z' },
                },
              ],
            },
          }
        : { body: { items: [] } },
    )
    const videos = await client.getVideos(ids(51))
    expect(requests).toHaveLength(2)
    expect(requests[0]?.url.searchParams.get('part')).toBe(
      'snippet,contentDetails,liveStreamingDetails',
    )
    expect(videos[0]).toEqual({
      id: 'v0',
      title: 'Hello',
      channelId: 'UCa',
      publishedAt: new Date('2026-11-05T10:00:00Z'),
      durationSeconds: 723,
      liveBroadcastContent: 'none',
      hasLiveStreamingDetails: false,
    })
    expect(videos[1]).toMatchObject({
      liveBroadcastContent: 'upcoming',
      hasLiveStreamingDetails: true,
      durationSeconds: 0,
    })
  })
})

describe('insertPlaylistItem', () => {
  it('POSTs the video resource', async () => {
    const { client, requests } = setup(() => ({ body: { id: 'item1' } }))
    await client.insertPlaylistItem('PL1', 'vid1')
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.url.searchParams.get('part')).toBe('snippet')
    expect(requests[0]?.headers['content-type']).toBe('application/json')
    expect(requests[0]?.body).toEqual({
      snippet: { playlistId: 'PL1', resourceId: { kind: 'youtube#video', videoId: 'vid1' } },
    })
  })
})

describe('auth and errors', () => {
  it('refreshes the token once after a 401 and retries', async () => {
    const { client, requests, getAccessToken } = setup((_req, i) =>
      i === 0 ? { status: 401, body: googleError(401, 'authError') } : { body: { items: [] } },
    )
    await client.listMyPlaylists()
    expect(getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true })
    expect(requests[1]?.headers['authorization']).toBe('Bearer fresh-token')
  })

  it('reports unauthorized when the refreshed token is also rejected', async () => {
    const { client } = setup(() => ({ status: 401, body: googleError(401, 'authError') }))
    await expect(client.listMyPlaylists()).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('passes through errors thrown by the token provider (e.g. revoked sign-in)', async () => {
    const requests = stubFetch(() => ({ body: {} }))
    const client = createYouTubeClient({
      getAccessToken: async () => {
        throw new YouTubeApiError('unauthorized', 'invalid_grant')
      },
    })
    await expect(client.listMyPlaylists()).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(requests).toHaveLength(0)
  })

  it.each([
    [403, 'quotaExceeded', 'quotaExceeded'],
    [404, 'playlistNotFound', 'playlistNotFound'],
    [403, 'playlistContainsMaximumNumberOfVideos', 'playlistFull'],
    [404, 'videoNotFound', 'videoNotFound'],
    [403, 'rateLimitExceeded', 'rateLimited'],
    [500, 'backendError', 'unknown'],
  ])('maps HTTP %i %s to kind %s', async (status, reason, kind) => {
    const { client } = setup(() => ({ status, body: googleError(status, reason, `msg ${reason}`) }))
    const err = await client.insertPlaylistItem('PL', 'v').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(YouTubeApiError)
    expect(err).toMatchObject({ kind, message: `msg ${reason}` })
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [429, 'rateLimited'],
    [502, 'unknown'],
  ])('falls back to HTTP %i → %s without a body', async (status, kind) => {
    const { client } = setup(() => ({ status }))
    await expect(client.insertPlaylistItem('PL', 'v')).rejects.toMatchObject({ kind })
  })

  it('maps failed connections to kind network', async () => {
    const { client } = setup(() => new TypeError('fetch failed'))
    await expect(client.listMyPlaylists()).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('isShortVideo', () => {
  it('is true when /shorts/{id} answers 200', async () => {
    const requests = stubFetch(() => ({ status: 200 }))
    expect(await isShortVideo('abc')).toBe(true)
    expect(requests[0]?.method).toBe('HEAD')
    expect(requests[0]?.url.href).toBe('https://www.youtube.com/shorts/abc')
  })

  it('is false when it redirects to /watch', async () => {
    stubFetch(() => ({ status: 303 }))
    expect(await isShortVideo('abc')).toBe(false)
  })

  it('is false (treated as regular) on network failure', async () => {
    stubFetch(() => new TypeError('offline'))
    expect(await isShortVideo('abc')).toBe(false)
  })
})
