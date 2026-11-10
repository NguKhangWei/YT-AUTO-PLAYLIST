import { describe, expect, it, vi } from 'vitest'
import type { Bridge } from '../../../shared/api'
import { ApiError, createApi } from './api'

const bridge = (over: Partial<Bridge['youtube']> = {}): Bridge => ({
  versions: { electron: '1', chrome: '1', node: '1' },
  auth: {
    getStatus: vi.fn(),
    signIn: vi.fn(),
    cancelSignIn: vi.fn(),
    signOut: vi.fn(),
    onStatusChange: vi.fn(() => () => undefined),
  },
  youtube: { listMyPlaylists: vi.fn(), ...over },
})

describe('createApi', () => {
  it('unwraps ok envelopes', async () => {
    const api = createApi(
      bridge({
        listMyPlaylists: async () => ({ ok: true, data: [{ id: 'PL', title: 'T', itemCount: 0 }] }),
      }),
    )
    expect(await api.youtube.listMyPlaylists()).toEqual([{ id: 'PL', title: 'T', itemCount: 0 }])
  })

  it('throws ApiError with the kind for error envelopes', async () => {
    const api = createApi(
      bridge({
        listMyPlaylists: async () => ({
          ok: false,
          error: { kind: 'unauthorized', message: 'Sign in again' },
        }),
      }),
    )
    const err = await api.youtube.listMyPlaylists().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ kind: 'unauthorized', message: 'Sign in again' })
  })
})
