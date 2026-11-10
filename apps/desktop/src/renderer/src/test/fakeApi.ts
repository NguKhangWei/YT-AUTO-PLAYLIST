import { vi } from 'vitest'
import type {
  Api,
  AuthStatus,
  Channel,
  ChannelSearchResult,
  Playlist,
  QuotaStatus,
  RunView,
  SchedulerInput,
  SchedulerView,
} from '../../../shared/api'
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
    quotaWarning: false,
    deactivated: false,
  },
  ...over,
})

/** A channel as search returns it. */
export const channel = (n: number, over: Partial<Channel> = {}): Channel => ({
  id: `UC${String(n).padStart(22, '0')}`,
  title: `Channel ${n}`,
  handle: `@channel${n}`,
  subscriberCount: 1_250_000,
  uploadsPlaylistId: `UU${String(n).padStart(22, '0')}`,
  ...over,
})

/**
 * A controllable fake of the renderer `Api`. Schedulers live in memory and
 * enforce one-playlist-per-scheduler like main does. `emit`/`emitQuota`
 * simulate pushes from main.
 */
export function fakeApi(
  initial: AuthStatus,
  opts: {
    playlists?: Playlist[]
    schedulers?: SchedulerView[]
    search?: (query: string) => ChannelSearchResult
    quota?: QuotaStatus
    runs?: RunView[]
    /** What "Run now" resolves with (default: a successful run adding 2 videos). */
    runResult?: (schedulerId: string) => RunView
    paused?: boolean
  } = {},
) {
  const listeners = new Set<(s: AuthStatus) => void>()
  const runListeners = new Set<() => void>()
  const stateListeners = new Set<(s: { paused: boolean }) => void>()
  let paused = opts.paused ?? false
  let runs = [...(opts.runs ?? [])]
  const quotaListeners = new Set<(s: QuotaStatus) => void>()
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
    channels: {
      search: vi.fn(
        async (query: string): Promise<ChannelSearchResult> =>
          opts.search?.(query) ?? { source: 'search', channels: [channel(1), channel(2)] },
      ),
    },
    quota: {
      get: vi.fn(
        async (): Promise<QuotaStatus> =>
          opts.quota ?? { used: 0, limit: 10_000, resetsAt: '2026-11-11T08:00:00.000Z' },
      ),
      onChange: vi.fn((l: (s: QuotaStatus) => void) => {
        quotaListeners.add(l)
        return () => quotaListeners.delete(l)
      }),
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
      runNow: vi.fn(async (id: string) => {
        const name = schedulers.find((x) => x.id === id)?.name ?? '?'
        const r =
          opts.runResult?.(id) ?? run({ id: `r${nextId++}`, schedulerId: id, schedulerName: name })
        runs = [r, ...runs]
        schedulers = schedulers.map((x) => (x.id === id ? { ...x, lastRun: r } : x))
        return r
      }),
    },
    runs: {
      list: vi.fn(async (o?: { schedulerId?: string }) =>
        runs.filter((r) => !o?.schedulerId || r.schedulerId === o.schedulerId),
      ),
      onChange: vi.fn((l: () => void) => {
        runListeners.add(l)
        return () => runListeners.delete(l)
      }),
    },
    debug: {
      lookback: vi.fn(async () => undefined),
    },
    app: {
      getState: vi.fn(async () => ({ paused })),
      setPaused: vi.fn(async (p: boolean) => {
        paused = p
        return { paused }
      }),
      onStateChange: vi.fn((l: (s: { paused: boolean }) => void) => {
        stateListeners.add(l)
        return () => stateListeners.delete(l)
      }),
    },
  } satisfies Api
  return {
    api,
    emit: (s: AuthStatus) => listeners.forEach((l) => l(s)),
    emitQuota: (q: QuotaStatus) => quotaListeners.forEach((l) => l(q)),
    emitRuns: () => runListeners.forEach((l) => l()),
    emitState: (s: { paused: boolean }) => stateListeners.forEach((l) => l(s)),
  }
}
