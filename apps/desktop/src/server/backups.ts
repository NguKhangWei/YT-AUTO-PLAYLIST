// A daily copy of the database in <data>/backups, keeping the newest 7 (no paid disk snapshots).
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

const NAME = /^auto-yt-\d{4}-\d{2}-\d{2}\.db$/
const CHECK_MS = 60 * 60_000 // look once an hour; at most one backup per (UTC) day

export interface BackupOptions {
  db: DatabaseSync
  dir: string
  now: () => Date
  keep?: number
  log?: (message: string, error: unknown) => void
}

export function createBackups(opts: BackupOptions) {
  const keep = opts.keep ?? 7
  let timer: ReturnType<typeof setInterval> | undefined

  /** Writes today's backup if it doesn't exist yet; returns its path, or null if there was nothing to do. */
  function runIfDue(): string | null {
    mkdirSync(opts.dir, { recursive: true })
    const path = join(opts.dir, `auto-yt-${opts.now().toISOString().slice(0, 10)}.db`)
    if (existsSync(path)) return null
    // VACUUM INTO writes a consistent, compacted copy while the app keeps running.
    opts.db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`)
    chmodSync(path, 0o600)
    const old = readdirSync(opts.dir)
      .filter((f) => NAME.test(f))
      .sort()
      .reverse()
      .slice(keep)
    for (const f of old) rmSync(join(opts.dir, f), { force: true })
    return path
  }

  const safeRun = () => {
    try {
      runIfDue()
    } catch (e) {
      opts.log?.('Database backup failed', e)
    }
  }

  return {
    runIfDue,
    start(): void {
      safeRun()
      timer = setInterval(safeRun, CHECK_MS)
      timer.unref()
    },
    stop(): void {
      clearInterval(timer)
    },
  }
}
