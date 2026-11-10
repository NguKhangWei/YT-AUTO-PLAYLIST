// Runs scans one at a time, records them in the history and notifies the user.
import { randomUUID } from 'node:crypto'
import type { RunView } from '../shared/api'
import { runScan, type ScanDeps } from './core/scan'
import type { SqliteStorage } from './db/sqlite-storage'
import { notificationFor, type NotificationText } from './notifications'

export interface RunnerDeps {
  storage: SqliteStorage
  youtube: ScanDeps['client']
  isShort: ScanDeps['isShort']
  now: () => Date
  notify: (n: NotificationText) => void
  onChange: () => void // a run started or finished
  log?: (message: string, error: unknown) => void
}

/**
 * Creates a queue that scans one scheduler at a time, so scans never race.
 * Asking for a scheduler that's already queued returns that same run.
 */
export function createRunner(deps: RunnerDeps) {
  const { storage } = deps
  let tail: Promise<unknown> = Promise.resolve()
  const pending = new Map<string, Promise<RunView>>()

  async function execute(schedulerId: string, trigger: RunView['trigger']): Promise<RunView> {
    const scheduler = storage.getScheduler(schedulerId)
    if (!scheduler) throw new Error('That scheduler no longer exists.')

    const runId = randomUUID()
    storage.startRun({ id: runId, schedulerId, trigger, startedAt: deps.now() })
    deps.onChange()
    try {
      const r = await runScan(schedulerId, { ...deps, client: deps.youtube })
      storage.finishRun(runId, {
        status: r.status,
        finishedAt: r.finishedAt,
        addedCount: r.added.length,
        error: r.error,
        details: {
          added: r.added.map((v) => ({
            id: v.id,
            title: v.title,
            publishedAt: v.publishedAt.toISOString(),
          })),
          skipped: r.skipped,
          unavailableChannels: r.unavailableChannels.map((c) => ({ id: c.id, title: c.title })),
          deactivated: r.deactivated,
        },
      })
    } catch (e) {
      deps.log?.(`Scan of ${schedulerId} crashed`, e) // a bug: record it instead of leaving it "running"
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
    /** Queues a scan and resolves with the finished run. */
    run(schedulerId: string, trigger: RunView['trigger'] = 'manual'): Promise<RunView> {
      const existing = pending.get(schedulerId)
      if (existing) return existing
      const job = tail
        .then(() => execute(schedulerId, trigger))
        .finally(() => pending.delete(schedulerId))
      pending.set(schedulerId, job)
      tail = job.catch(() => undefined) // a failed run doesn't block the queue
      return job
    },
  }
}

export type Runner = ReturnType<typeof createRunner>
