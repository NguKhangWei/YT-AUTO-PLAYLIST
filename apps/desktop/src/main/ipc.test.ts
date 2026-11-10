import { YouTubeApiError } from '@auto-yt/core'
import { describe, expect, it } from 'vitest'
import { listMyPlaylists, toErrorInfo, wrap } from './ipc'

describe('wrap', () => {
  it('returns data in an ok envelope', async () => {
    const handler = wrap(async (a: number, b: number) => a + b)
    expect(await handler({}, 2, 3)).toEqual({ ok: true, data: 5 })
  })

  it('turns thrown errors into an error envelope that keeps the kind', async () => {
    const handler = wrap(async () => {
      throw new YouTubeApiError('quotaExceeded', 'Quota used up')
    })
    expect(await handler({})).toEqual({
      ok: false,
      error: { kind: 'quotaExceeded', message: 'Quota used up' },
    })
  })
})

describe('toErrorInfo', () => {
  it('handles plain errors and non-errors', () => {
    expect(toErrorInfo(new Error('x'))).toEqual({ kind: 'error', message: 'x' })
    expect(toErrorInfo('weird')).toEqual({ kind: 'error', message: 'weird' })
  })
})

describe('listMyPlaylists', () => {
  it('explains an account without a YouTube channel', async () => {
    const youtube = {
      listMyPlaylists: async () => {
        throw new YouTubeApiError('notFound', 'Channel not found.', 404, 'channelNotFound')
      },
    }
    await expect(listMyPlaylists(youtube)).rejects.toMatchObject({
      kind: 'noChannel',
      message: expect.stringContaining('has no YouTube channel'),
    })
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
