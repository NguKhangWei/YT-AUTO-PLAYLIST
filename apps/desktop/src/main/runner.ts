import { randomUUID } from 'node:crypto'
import { runScan, type ScanDeps, type ScanResult } from '@auto-yt/core'
import type { RunDetails, RunView } from '../shared/api'
import type { SqliteStorage } from './db/sqlite-storage'
import { notificationFor, type NotificationText } from './notifications'

export interface RunnerDeps {
  storage: SqliteStorage
  youtube: ScanDeps['client']
  isShort: ScanDeps['isShort']
  /** Units left today by the app's own count, for the quota warning. */
  quotaRemaining: () => number
  now: () => Date
  notify: (n: NotificationText) => void
  /** Called when a run starts or finishes, so the UI can refresh. */
  onChange: () => void
  log?: (message: string, error: unknown) => void
}

function details(r: ScanResult): RunDetails {
  return {
    added: r.added.map((v) => ({
      id: v.id,
      title: v.title,
      publishedAt: v.publishedAt.toISOString(),
    })),
    skipped: r.skipped,
    unavailableChannels: r.unavailableChannels.map((c) => ({ id: c.id, title: c.title })),
    quotaWarning: r.quotaWarning,
    deactivated: r.deactivated,
  }
}

/**
 * Runs scans one at a time (so they never race for quota), records each one
 * in the run history and notifies the user. Asking to run a scheduler that is
 * already queued or running returns that same run.
 */
export function createRunner(deps: RunnerDeps) {
  const { storage } = deps
  let tail: Promise<unknown> = Promise.resolve()
  const pending = new Map<string, Promise<RunView>>()

  async function execute(schedulerId: string, trigger: RunView['trigger']): Promise<RunView> {
    const scheduler = await storage.getScheduler(schedulerId)
    if (!scheduler)
      throw Object.assign(new Error('That scheduler no longer exists.'), { kind: 'validation' })

    const runId = randomUUID()
    storage.startRun({ id: runId, schedulerId, trigger, startedAt: deps.now() })
    deps.onChange()

    try {
      const result = await runScan(schedulerId, {
        storage,
        client: deps.youtube,
        isShort: deps.isShort,
        now: deps.now,
        quotaRemaining: deps.quotaRemaining,
      })
      storage.finishRun(runId, {
        status: result.status,
        finishedAt: result.finishedAt,
        addedCount: result.added.length,
        error: result.error,
        details: details(result),
      })
    } catch (e) {
      // A bug, not an API error: record it rather than leave the run "running".
      deps.log?.(`Scan of ${schedulerId} crashed`, e)
      storage.finishRun(runId, {
        status: 'error',
        finishedAt: deps.now(),
        addedCount: 0,
        error: { kind: 'internal', message: e instanceof Error ? e.message : String(e) },
      })
    }

    const run = storage.listRuns({ schedulerId, limit: 1 })[0]!
    deps.onChange()
    const text = notificationFor(run, scheduler.playlistTitle)
    if (text) deps.notify(text)
    return run
  }

  return {
    /** Queue a scan; resolves with the finished run. */
    run(schedulerId: string, trigger: RunView['trigger'] = 'manual'): Promise<RunView> {
      const existing = pending.get(schedulerId)
      if (existing) return existing
      const job = tail.then(() => execute(schedulerId, trigger))
      const tracked = job.finally(() => pending.delete(schedulerId))
      pending.set(schedulerId, tracked)
      tail = tracked.catch(() => undefined) // one failure doesn't block the queue
      return tracked
    },
    isQueued: (schedulerId: string) => pending.has(schedulerId),
    /** Resolves when every queued scan has finished (for tests and shutdown). */
    idle: () => tail.then(() => undefined),
  }
}

export type Runner = ReturnType<typeof createRunner>
