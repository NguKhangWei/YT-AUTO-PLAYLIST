import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import { YouTubeApiError } from './core/youtube/errors'
import { createHandlers, listMyPlaylists, registerIpc, wrap } from './ipc'

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

describe('createHandlers / registerIpc', () => {
  const deps = () =>
    ({
      auth: { status: vi.fn(), signIn: vi.fn(), cancelSignIn: vi.fn(), signOut: vi.fn() },
      youtube: { listMyPlaylists: vi.fn(async () => []) },
      schedulers: { list: vi.fn(() => []), remove: vi.fn() },
      channels: { search: vi.fn() },
      runner: { run: vi.fn() },
      storage: { listRuns: vi.fn(() => []) },
      loop: { isPaused: vi.fn(() => true), setPaused: vi.fn() },
    }) as never

  it('handles every call channel (pushes are not calls)', () => {
    const pushes: string[] = [IPC.authStatusChanged, IPC.runsChanged, IPC.scansPausedChanged]
    const calls = Object.values(IPC).filter((c) => !pushes.includes(c))
    expect(Object.keys(createHandlers(deps())).sort()).toEqual([...calls].sort())
  })

  it('routes arguments to the services', async () => {
    const d = deps() as unknown as {
      schedulers: { remove: ReturnType<typeof vi.fn> }
      loop: { setPaused: ReturnType<typeof vi.fn> }
    }
    const h = createHandlers(d as never)
    await h[IPC.schedulersRemove]!('s1')
    expect(d.schedulers.remove).toHaveBeenCalledWith('s1')
    expect(await h[IPC.scansSetPaused]!(true)).toBe(true)
    expect(d.loop.setPaused).toHaveBeenCalledWith(true)
  })

  it('registers each handler with Electron, wrapped in an envelope', async () => {
    const handle = vi.fn()
    registerIpc({ handle }, { 'x:y': (a: number) => a * 2 })
    expect(handle).toHaveBeenCalledWith('x:y', expect.any(Function))
    expect(await handle.mock.calls[0]![1]({}, 21)).toEqual({ ok: true, data: 42 })
  })
})
