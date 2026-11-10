// A controllable fake of `window.api` for renderer tests.
import { vi } from 'vitest'
import type {
  Api,
  AuthStatus,
  Channel,
  Playlist,
  RunView,
  SchedulerInput,
  SchedulerView,
} from '../../../shared/api'

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
  channels: [],
  active: true,
  createdAt: '2026-11-10T00:00:00.000Z',
  nextRunAt: '2026-11-11T01:00:00.000Z',
  ...over,
})

export const run = (over: Partial<RunView> = {}): RunView => ({
  id: 'r1',
  schedulerId: 's1',
  schedulerName: 'Gaming',
  trigger: 'manual',
  status: 'ok',
  startedAt: '2026-11-10T02:00:00.000Z',
  finishedAt: '2026-11-10T02:00:05.000Z',
  addedCount: 2,
  details: {
    added: [
      { id: 'v1', title: 'First video', publishedAt: '2026-11-09T10:00:00.000Z' },
      { id: 'v2', title: 'Second video', publishedAt: '2026-11-09T12:00:00.000Z' },
    ],
    skipped: [{ videoId: 'v3', title: 'A short', reason: 'short' }],
    unavailableChannels: [],
    deactivated: false,
  },
  ...over,
})

export const channel = (n: number, over: Partial<Channel> = {}): Channel => ({
  id: `UC${String(n).padStart(22, '0')}`,
  title: `Channel ${n}`,
  handle: `@channel${n}`,
  subscriberCount: 1_250_000,
  uploadsPlaylistId: `UU${String(n).padStart(22, '0')}`,
  ...over,
})

/**
 * Schedulers live in memory and one playlist per scheduler is enforced like
 * main does. `emit*` simulate pushes from main.
 */
export function fakeApi(
  initial: AuthStatus,
  opts: {
    playlists?: Playlist[]
    schedulers?: SchedulerView[]
    search?: (query: string) => Channel[]
    runs?: RunView[]
    paused?: boolean
  } = {},
) {
  const authListeners = new Set<(s: AuthStatus) => void>()
  const runListeners = new Set<() => void>()
  const pausedListeners = new Set<(p: boolean) => void>()
  let schedulers = [...(opts.schedulers ?? [])]
  let runs = [...(opts.runs ?? [])]
  let paused = opts.paused ?? false
  let nextId = 100

  const check = (input: SchedulerInput, exceptId?: string) => {
    const owner = schedulers.find((s) => s.playlistId === input.playlistId && s.id !== exceptId)
    if (owner) throw new Error(`That playlist is already used by "${owner.name}".`)
    if (!input.name.trim()) throw new Error('Give the scheduler a name.')
  }
  const update = (id: string, change: Partial<SchedulerView>) => {
    const s = { ...schedulers.find((x) => x.id === id)!, ...change }
    schedulers = schedulers.map((x) => (x.id === id ? s : x))
    return s
  }

  const api = {
    auth: {
      getStatus: vi.fn(async () => initial),
      signIn: vi.fn(async () => signedIn),
      cancelSignIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => signedOut),
      onStatusChange: vi.fn((l: (s: AuthStatus) => void) => {
        authListeners.add(l)
        return () => authListeners.delete(l)
      }),
    },
    youtube: {
      listMyPlaylists: vi.fn(async () => opts.playlists ?? []),
    },
    channels: {
      search: vi.fn(async (q: string) => opts.search?.(q) ?? [channel(1), channel(2)]),
    },
    schedulers: {
      list: vi.fn(async () => schedulers),
      create: vi.fn(async (input: SchedulerInput) => {
        check(input)
        const s = view({ ...input, id: `s${nextId++}`, name: input.name.trim() })
        schedulers = [...schedulers, s]
        return s
      }),
      update: vi.fn(async (id: string, input: SchedulerInput) => {
        check(input, id)
        return update(id, input)
      }),
      setActive: vi.fn(async (id: string, active: boolean) => update(id, { active })),
      remove: vi.fn(async (id: string) => {
        schedulers = schedulers.filter((x) => x.id !== id)
      }),
      runNow: vi.fn(async (id: string) => {
        const name = schedulers.find((x) => x.id === id)?.name ?? '?'
        const r = run({ id: `r${nextId++}`, schedulerId: id, schedulerName: name })
        runs = [r, ...runs]
        update(id, { lastRun: r })
        return r
      }),
    },
    runs: {
      list: vi.fn(async () => runs),
      onChange: vi.fn((l: () => void) => {
        runListeners.add(l)
        return () => runListeners.delete(l)
      }),
    },
    scans: {
      isPaused: vi.fn(async () => paused),
      setPaused: vi.fn(async (p: boolean) => (paused = p)),
      onPausedChange: vi.fn((l: (p: boolean) => void) => {
        pausedListeners.add(l)
        return () => pausedListeners.delete(l)
      }),
    },
  } satisfies Api

  return {
    api,
    emit: (s: AuthStatus) => authListeners.forEach((l) => l(s)),
    emitRuns: () => runListeners.forEach((l) => l()),
    emitPaused: (p: boolean) => pausedListeners.forEach((l) => l(p)),
  }
}
