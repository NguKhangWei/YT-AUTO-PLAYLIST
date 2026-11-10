// Starts scheduled scans when they're due, and catches up ones missed while the PC was off.
import { nextRunIfDue } from './core/schedule'
import type { SqliteStorage } from './db/sqlite-storage'
import type { NotificationText } from './notifications'
import type { Runner } from './runner'

export const TICK_MS = 60_000 // longest wait between checks
const PAUSED_KEY = 'scansPaused'

export interface SchedulerLoopDeps {
  storage: Pick<SqliteStorage, 'listSchedulers' | 'setNextRunAt' | 'getSetting' | 'setSetting'>
  runner: Pick<Runner, 'run'>
  now: () => Date
  isSignedIn: () => Promise<boolean>
  notify: (n: NotificationText) => void
  onChange: () => void // next-run times or the paused state changed
  log?: (message: string, error: unknown) => void
}

/**
 * Each check gives every active, due scheduler one scan (however many slots
 * were missed) and moves its next run to the following slot. While paused or
 * signed out, due scans wait and run once that changes.
 */
export function createSchedulerLoop(deps: SchedulerLoopDeps) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let checking: Promise<string[]> | null = null
  let toldSignedOut = false

  const isPaused = () => deps.storage.getSetting(PAUSED_KEY, false)

  async function check(): Promise<string[]> {
    if (isPaused()) return []
    const now = deps.now()
    const due = deps.storage
      .listSchedulers()
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, next: nextRunIfDue(s, s.nextRunAt, now) }))
      .filter((d): d is { id: string; next: Date } => d.next !== null)
    if (due.length === 0) return []

    if (!(await deps.isSignedIn())) {
      if (!toldSignedOut) {
        toldSignedOut = true // say it once, not every minute
        deps.notify({
          title: 'auto-yt: scans are waiting for you to sign in',
          body: 'Open auto-yt and sign in with Google. Missed scans run once you do.',
        })
      }
      return []
    }
    toldSignedOut = false

    for (const { id, next } of due) {
      deps.storage.setNextRunAt(id, next) // before scanning, so a crash can't repeat it
      deps.runner.run(id, 'scheduled').catch((e: unknown) => deps.log?.(`Scan of ${id} failed`, e))
    }
    deps.onChange()
    return due.map((d) => d.id)
  }

  /** Checks now; overlapping calls share one check. Resolves with the ids started. */
  function tick(): Promise<string[]> {
    checking ??= check()
      .catch((e: unknown) => {
        deps.log?.('Scheduler check failed', e)
        return []
      })
      .finally(() => (checking = null))
    return checking
  }

  /** Sleeps until the earliest next run (at most TICK_MS), then checks again. */
  function scheduleNext(): void {
    if (!running) return
    clearTimeout(timer)
    const now = deps.now().getTime()
    const earliest = Math.min(
      TICK_MS,
      ...deps.storage
        .listSchedulers()
        .filter((s) => s.active)
        .map((s) => s.nextRunAt.getTime() - now),
    )
    timer = setTimeout(() => void tick().then(scheduleNext), Math.max(0, earliest) + 250)
  }

  /** Something changed (wake, sign-in, an edit): check now. */
  function poke(): void {
    if (running) void tick().then(scheduleNext)
  }

  return {
    tick,
    poke,
    isPaused,
    /** Checks right away (catch-up), then keeps checking. */
    start(): void {
      running = true
      void tick().then(scheduleNext)
    },
    stop(): void {
      running = false
      clearTimeout(timer)
    },
    /** Pauses or resumes scheduled scans; remembered across restarts. */
    setPaused(paused: boolean): void {
      deps.storage.setSetting(PAUSED_KEY, paused)
      deps.onChange()
      if (!paused) poke()
    },
  }
}

export type SchedulerLoop = ReturnType<typeof createSchedulerLoop>
