import { vi } from 'vitest'
import type { Api, AuthStatus, Playlist, SchedulerInput, SchedulerView } from '../../../shared/api'
import { ApiError } from '../lib/api'

export const signedOut: AuthStatus = { configured: true, signedIn: false, signingIn: false }
export const signedIn: AuthStatus = {
  configured: true,
  signedIn: true,
  signingIn: false,
  profile: { name: 'Khang Wei', pictureUrl: 'https://lh3.googleusercontent.com/a/p' },
}

export const view = (over: Partial<SchedulerView> = {}): SchedulerView => ({
  id: 's1',
  name: 'Gaming',
  playlistId: 'PL1',
  playlistTitle: 'Gaming videos',
  intervalDays: 1,
  timeOfDay: '09:00',
  timezone: 'Asia/Kuala_Lumpur',
  active: true,
  createdAt: '2026-11-10T00:00:00.000Z',
  nextRunAt: '2026-11-11T01:00:00.000Z',
  channels: [],
  ...over,
})

/**
 * A controllable fake of the renderer `Api`. Schedulers live in memory and
 * enforce one-playlist-per-scheduler like main does. `emit` simulates a
 * main-process auth status push.
 */
export function fakeApi(
  initial: AuthStatus,
  opts: { playlists?: Playlist[]; schedulers?: SchedulerView[] } = {},
) {
  const listeners = new Set<(s: AuthStatus) => void>()
  let schedulers = [...(opts.schedulers ?? [])]
  let nextId = 100

  const assertFree = (input: SchedulerInput, exceptId?: string) => {
    const owner = schedulers.find((s) => s.playlistId === input.playlistId && s.id !== exceptId)
    if (owner) throw new ApiError('validation', `That playlist is already used by "${owner.name}".`)
    if (!input.name.trim()) throw new ApiError('validation', 'Give the scheduler a name.')
  }

  const api = {
    versions: { electron: '45', chrome: '156', node: '24' },
    auth: {
      getStatus: vi.fn(async () => initial),
      signIn: vi.fn(async () => signedIn),
      cancelSignIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => signedOut),
      onStatusChange: vi.fn((l: (s: AuthStatus) => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      }),
    },
    youtube: {
      listMyPlaylists: vi.fn(async () => opts.playlists ?? []),
    },
    schedulers: {
      list: vi.fn(async () => schedulers),
      create: vi.fn(async (input: SchedulerInput) => {
        assertFree(input)
        const s = view({ ...input, id: `s${nextId++}`, name: input.name.trim() })
        schedulers = [...schedulers, s]
        return s
      }),
      update: vi.fn(async (id: string, input: SchedulerInput) => {
        assertFree(input, id)
        const s = { ...schedulers.find((x) => x.id === id)!, ...input }
        schedulers = schedulers.map((x) => (x.id === id ? s : x))
        return s
      }),
      setActive: vi.fn(async (id: string, active: boolean) => {
        const s = { ...schedulers.find((x) => x.id === id)!, active }
        schedulers = schedulers.map((x) => (x.id === id ? s : x))
        return s
      }),
      remove: vi.fn(async (id: string) => {
        schedulers = schedulers.filter((x) => x.id !== id)
      }),
    },
  } satisfies Api
  return { api, emit: (s: AuthStatus) => listeners.forEach((l) => l(s)) }
}
