import { describe, expect, it } from 'vitest'
import { YouTubeApiError } from './core/youtube/errors'
import { listMyPlaylists, wrap } from './ipc'

describe('wrap', () => {
  it('returns data in an ok envelope', async () => {
    const handler = wrap(async (a: number, b: number) => a + b)
    expect(await handler({}, 2, 3)).toEqual({ ok: true, data: 5 })
  })

  it('returns the error message unchanged', async () => {
    const handler = wrap(async () => {
      throw new YouTubeApiError('quotaExceeded', 'Quota used up')
    })
    expect(await handler({})).toEqual({ ok: false, error: 'Quota used up' })
    expect(await wrap(() => Promise.reject('weird'))({})).toEqual({ ok: false, error: 'weird' })
  })
})

describe('listMyPlaylists', () => {
  it('explains an account without a YouTube channel', async () => {
    const youtube = {
      listMyPlaylists: async () => {
        throw new YouTubeApiError('notFound', 'Channel not found.')
      },
    }
    await expect(listMyPlaylists(youtube)).rejects.toThrow('has no YouTube channel')
  })

  it('passes other results and errors through', async () => {
    expect(await listMyPlaylists({ listMyPlaylists: async () => [] })).toEqual([])
    const quota = new YouTubeApiError('quotaExceeded', 'q')
    await expect(
      listMyPlaylists({
        listMyPlaylists: async () => {
          throw quota
        },
      }),
    ).rejects.toBe(quota)
  })
})
