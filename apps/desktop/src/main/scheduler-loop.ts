import { checkDue } from '@auto-yt/core'
import type { SqliteStorage } from './db/sqlite-storage'
import type { NotificationText } from './notifications'
import type { Runner } from './runner'

/** Longest wait between checks; the loop also wakes exactly when the next scan is due. */
export const TICK_MS = 60_000
export const PAUSED_KEY = 'scansPaused'

export interface SchedulerLoopDeps {
  storage: Pick<SqliteStorage, 'listSchedulers' | 'setNextRunAt' | 'getSetting' | 'setSetting'>
  runner: Pick<Runner, 'run'>
  now: () => Date
  isSignedIn: () => Promise<boolean>
  notify: (n: NotificationText) => void
  /** Next-run times or the paused state changed (refresh the UI and tray). */
  onChange: () => void
  timers?: {
    set: (fn: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
  }
  log?: (message: string, error: unknown) => void
}

/**
 * Starts scheduled scans. On every check, each active scheduler whose next
 * scan time has passed gets **one** scan, however many slots were missed
 * (PC off, app closed), and its next scan moves to the following slot on its
 * cadence. Scans are only started while signed in and not paused; otherwise
 * due scans wait and run once that changes.
 */
export function createSchedulerLoop(deps: SchedulerLoopDeps) {
  const timers = deps.timers ?? {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
  let handle: unknown = null
  let running = false
  let ticking: Promise<string[]> | null = null
  let toldSignedOut = false

  const isPaused = () => deps.storage.getSetting(PAUSED_KEY, false)

  function dueSchedulers(now: Date) {
    const due: { id: string; next: Date }[] = []
    for (const s of deps.storage.listSchedulers()) {
      if (!s.active) continue
      try {
        const check = checkDue(s, s.nextRunAt, now)
        if (check.due) due.push({ id: s.id, next: check.nextRunAt })
      } catch (e) {
        deps.log?.(`Scheduler ${s.id} has an invalid schedule`, e)
      }
    }
    return due
  }

  async function check(): Promise<string[]> {
    if (isPaused()) return []
    const due = dueSchedulers(deps.now())
    if (due.length === 0) return []

    if (!(await deps.isSignedIn())) {
      // Leave them due: they run once you sign in. Say so once, not every minute.
      if (!toldSignedOut) {
        toldSignedOut = true
        deps.notify({
          title: 'auto-yt: scans are waiting for you to sign in',
          body: 'Open auto-yt and sign in with Google. Missed scans run once you do.',
        })
      }
      return []
    }
    toldSignedOut = false

    for (const { id, next } of due) {
      // Move the schedule first, so a crash mid-scan can't make it run again and again.
      deps.storage.setNextRunAt(id, next)
      deps.runner.run(id, 'scheduled').catch((e: unknown) => deps.log?.(`Scan of ${id} failed`, e))
    }
    deps.onChange()
    return due.map((d) => d.id)
  }

  /** Run a check now (concurrent calls share one). Resolves with the ids started. */
  function tick(): Promise<string[]> {
    ticking ??= check()
      .catch((e: unknown) => {
        deps.log?.('Scheduler check failed', e)
        return []
      })
      .finally(() => {
        ticking = null
      })
    return ticking
  }

  /** Wait until the earliest next scan (at most TICK_MS), then check again. */
  function scheduleNext(): void {
    if (!running) return
    if (handle !== null) timers.clear(handle)
    const now = deps.now().getTime()
    let delay = TICK_MS
    for (const s of deps.storage.listSchedulers()) {
      if (s.active) delay = Math.min(delay, s.nextRunAt.getTime() - now)
    }
    delay = Math.max(0, delay) + 250 // land just after the slot, not just before
    handle = timers.set(() => {
      handle = null
      void tick().then(scheduleNext)
    }, delay)
  }

  return {
    tick,
    /** Check now (startup catch-up), then keep checking. */
    start(): void {
      running = true
      void tick().then(scheduleNext)
    },
    stop(): void {
      running = false
      if (handle !== null) timers.clear(handle)
      handle = null
    },
    /** Something changed (wake from sleep, sign-in, a scheduler edited): check now. */
    poke(): void {
      if (!running) return
      void tick().then(scheduleNext)
    },
    isPaused,
    /** Pause or resume all scheduled scans (persists across restarts). */
    setPaused(paused: boolean): void {
      deps.storage.setSetting(PAUSED_KEY, paused)
      deps.onChange()
      if (!paused && running) void tick().then(scheduleNext)
    },
  }
}

export type SchedulerLoop = ReturnType<typeof createSchedulerLoop>
