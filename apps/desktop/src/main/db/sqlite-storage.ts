import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Channel, ScanStorage, SchedulerRecord, TrackedChannel } from '@auto-yt/core'
import type { RunDetails, RunStatus, RunView } from '../../shared/api'

interface RunRow {
  id: string
  scheduler_id: string
  scheduler_name: string
  trigger: 'manual' | 'scheduled'
  status: RunStatus
  started_at: number
  finished_at: number | null
  added_count: number
  error_kind: string | null
  error_message: string | null
  details_json: string | null
}

const toRun = (r: RunRow): RunView => ({
  id: r.id,
  schedulerId: r.scheduler_id,
  schedulerName: r.scheduler_name,
  trigger: r.trigger,
  status: r.status,
  startedAt: new Date(r.started_at).toISOString(),
  ...(r.finished_at !== null ? { finishedAt: new Date(r.finished_at).toISOString() } : {}),
  addedCount: r.added_count,
  ...(r.error_kind !== null
    ? { error: { kind: r.error_kind, message: r.error_message ?? '' } }
    : {}),
  ...(r.details_json !== null ? { details: JSON.parse(r.details_json) as RunDetails } : {}),
})

const RUN_SELECT = `SELECT r.*, s.name AS scheduler_name FROM runs r
  JOIN schedulers s ON s.id = r.scheduler_id`

/** How many runs to keep in history (oldest are deleted). */
export const MAX_RUNS = 500

interface SchedulerRow {
  id: string
  name: string
  playlist_id: string
  playlist_title: string
  interval_days: number
  time_of_day: string
  timezone: string
  active: number
  created_at: number
  last_success_at: number | null
  next_run_at: number
}

interface TrackedRow {
  channel_id: string
  title: string
  handle: string | null
  thumbnail_url: string | null
  subscriber_count: number | null
  uploads_playlist_id: string
  since_at: number
}

const toScheduler = (r: SchedulerRow): SchedulerRecord => ({
  id: r.id,
  name: r.name,
  playlistId: r.playlist_id,
  playlistTitle: r.playlist_title,
  intervalDays: r.interval_days,
  timeOfDay: r.time_of_day,
  timezone: r.timezone,
  active: r.active === 1,
  createdAt: new Date(r.created_at),
  ...(r.last_success_at !== null ? { lastSuccessAt: new Date(r.last_success_at) } : {}),
  nextRunAt: new Date(r.next_run_at),
})

const toTracked = (r: TrackedRow): TrackedChannel => ({
  channel: {
    id: r.channel_id,
    title: r.title,
    ...(r.handle !== null ? { handle: r.handle } : {}),
    ...(r.thumbnail_url !== null ? { thumbnailUrl: r.thumbnail_url } : {}),
    ...(r.subscriber_count !== null ? { subscriberCount: r.subscriber_count } : {}),
    uploadsPlaylistId: r.uploads_playlist_id,
  },
  sinceAt: new Date(r.since_at),
})

const schedulerParams = (s: SchedulerRecord): Record<string, SQLInputValue> => ({
  id: s.id,
  name: s.name,
  playlist_id: s.playlistId,
  playlist_title: s.playlistTitle,
  interval_days: s.intervalDays,
  time_of_day: s.timeOfDay,
  timezone: s.timezone,
  active: s.active ? 1 : 0,
  created_at: s.createdAt.getTime(),
  last_success_at: s.lastSuccessAt?.getTime() ?? null,
  next_run_at: s.nextRunAt.getTime(),
})

/** SQLite-backed storage: the core `ScanStorage` plus scheduler/channel CRUD for the app. */
export function createSqliteStorage(db: DatabaseSync) {
  const q = {
    getScheduler: db.prepare('SELECT * FROM schedulers WHERE id = ?'),
    listSchedulers: db.prepare('SELECT * FROM schedulers ORDER BY created_at, id'),
    insertScheduler: db.prepare(`
      INSERT INTO schedulers (id, name, playlist_id, playlist_title, interval_days, time_of_day,
        timezone, active, created_at, last_success_at, next_run_at)
      VALUES (:id, :name, :playlist_id, :playlist_title, :interval_days, :time_of_day,
        :timezone, :active, :created_at, :last_success_at, :next_run_at)`),
    updateScheduler: db.prepare(`
      UPDATE schedulers SET name = :name, playlist_id = :playlist_id,
        playlist_title = :playlist_title, interval_days = :interval_days,
        time_of_day = :time_of_day, timezone = :timezone, active = :active,
        created_at = :created_at, last_success_at = :last_success_at, next_run_at = :next_run_at
      WHERE id = :id`),
    deleteScheduler: db.prepare('DELETE FROM schedulers WHERE id = ?'),
    findByPlaylist: db.prepare('SELECT id FROM schedulers WHERE playlist_id = ?'),
    setLastSuccess: db.prepare('UPDATE schedulers SET last_success_at = ? WHERE id = ?'),
    setActive: db.prepare('UPDATE schedulers SET active = ? WHERE id = ?'),
    upsertChannel: db.prepare(`
      INSERT INTO channels (channel_id, title, handle, thumbnail_url, subscriber_count, uploads_playlist_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (channel_id) DO UPDATE SET title = excluded.title, handle = excluded.handle,
        thumbnail_url = excluded.thumbnail_url, subscriber_count = excluded.subscriber_count,
        uploads_playlist_id = excluded.uploads_playlist_id`),
    track: db.prepare(`
      INSERT INTO scheduler_channels (scheduler_id, channel_id, since_at) VALUES (?, ?, ?)
      ON CONFLICT DO UPDATE SET since_at = excluded.since_at`),
    untrack: db.prepare('DELETE FROM scheduler_channels WHERE scheduler_id = ? AND channel_id = ?'),
    listTracked: db.prepare(`
      SELECT c.*, sc.since_at FROM scheduler_channels sc
      JOIN channels c ON c.channel_id = sc.channel_id
      WHERE sc.scheduler_id = ? ORDER BY c.title COLLATE NOCASE`),
    listHandled: db.prepare('SELECT video_id FROM handled_videos WHERE scheduler_id = ?'),
    recordHandled: db.prepare(
      'INSERT OR IGNORE INTO handled_videos (scheduler_id, video_id, handled_at) VALUES (?, ?, ?)',
    ),
    getCache: db.prepare('SELECT results_json, fetched_at FROM search_cache WHERE query = ?'),
    putCache: db.prepare(`
      INSERT INTO search_cache (query, results_json, fetched_at) VALUES (?, ?, ?)
      ON CONFLICT (query) DO UPDATE SET results_json = excluded.results_json,
        fetched_at = excluded.fetched_at`),
    pruneCache: db.prepare('DELETE FROM search_cache WHERE fetched_at < ?'),
    addQuota: db.prepare(`
      INSERT INTO quota_usage (pt_date, units) VALUES (?, ?)
      ON CONFLICT (pt_date) DO UPDATE SET units = units + excluded.units`),
    getQuota: db.prepare('SELECT units FROM quota_usage WHERE pt_date = ?'),
    pruneQuota: db.prepare('DELETE FROM quota_usage WHERE pt_date < ?'),
    insertRun: db.prepare(`INSERT INTO runs (id, scheduler_id, trigger, status, started_at)
      VALUES (?, ?, ?, 'running', ?)`),
    finishRun: db.prepare(`UPDATE runs SET status = :status, finished_at = :finished_at,
      added_count = :added_count, error_kind = :error_kind, error_message = :error_message,
      details_json = :details_json WHERE id = :id`),
    listRuns: db.prepare(`${RUN_SELECT} ORDER BY r.started_at DESC, r.rowid DESC LIMIT ?`),
    listRunsFor: db.prepare(
      `${RUN_SELECT} WHERE r.scheduler_id = ? ORDER BY r.started_at DESC, r.rowid DESC LIMIT ?`,
    ),
    interrupt: db.prepare(`UPDATE runs SET status = 'error', finished_at = ?,
      error_kind = 'interrupted', error_message = 'The app closed before this scan finished.'
      WHERE status = 'running'`),
    pruneRuns: db.prepare(`DELETE FROM runs WHERE id NOT IN
      (SELECT id FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?)`),
    lookbackChannels: db.prepare(
      'UPDATE scheduler_channels SET since_at = ? WHERE scheduler_id = ?',
    ),
    clearLastSuccess: db.prepare('UPDATE schedulers SET last_success_at = NULL WHERE id = ?'),
  }

  const scan: ScanStorage = {
    async getScheduler(id) {
      const row = q.getScheduler.get(id) as SchedulerRow | undefined
      return row ? toScheduler(row) : null
    },
    async listTrackedChannels(schedulerId) {
      return (q.listTracked.all(schedulerId) as unknown as TrackedRow[]).map(toTracked)
    },
    async listAddedVideoIds(schedulerId) {
      const rows = q.listHandled.all(schedulerId) as { video_id: string }[]
      return new Set(rows.map((r) => r.video_id))
    },
    async recordAddedVideo(schedulerId, videoId, at) {
      q.recordHandled.run(schedulerId, videoId, at.getTime())
    },
    async setLastSuccessAt(schedulerId, at) {
      q.setLastSuccess.run(at.getTime(), schedulerId)
    },
    async setActive(schedulerId, active) {
      q.setActive.run(active ? 1 : 0, schedulerId)
    },
  }

  return {
    ...scan,
    listSchedulers(): SchedulerRecord[] {
      return (q.listSchedulers.all() as unknown as SchedulerRow[]).map(toScheduler)
    },
    /** Id of the scheduler already using `playlistId`, if any. */
    schedulerIdForPlaylist(playlistId: string): string | undefined {
      return (q.findByPlaylist.get(playlistId) as { id: string } | undefined)?.id
    },
    insertScheduler(s: SchedulerRecord): void {
      q.insertScheduler.run(schedulerParams(s))
    },
    /** Replace every column of an existing scheduler. */
    saveScheduler(s: SchedulerRecord): void {
      q.updateScheduler.run(schedulerParams(s))
    },
    /** Delete a scheduler with its channel links and history. */
    deleteScheduler(id: string): void {
      q.deleteScheduler.run(id)
    },
    trackChannel(schedulerId: string, channel: Channel, sinceAt: Date): void {
      q.upsertChannel.run(
        channel.id,
        channel.title,
        channel.handle ?? null,
        channel.thumbnailUrl ?? null,
        channel.subscriberCount ?? null,
        channel.uploadsPlaylistId,
      )
      q.track.run(schedulerId, channel.id, sinceAt.getTime())
    },
    untrackChannel(schedulerId: string, channelId: string): void {
      q.untrack.run(schedulerId, channelId)
    },
    /** Cached search results newer than `minFetchedAt`, or undefined. */
    getCachedSearch(query: string, minFetchedAt: Date): Channel[] | undefined {
      const row = q.getCache.get(query) as { results_json: string; fetched_at: number } | undefined
      if (!row || row.fetched_at < minFetchedAt.getTime()) return undefined
      return JSON.parse(row.results_json) as Channel[]
    },
    /** Store search results and drop entries older than `pruneBefore`. */
    putCachedSearch(query: string, channels: Channel[], at: Date, pruneBefore: Date): void {
      q.putCache.run(query, JSON.stringify(channels), at.getTime())
      q.pruneCache.run(pruneBefore.getTime())
    },
    /** Add API units to a Pacific-time quota day ("yyyy-MM-dd"); keeps 30 days of history. */
    addQuotaUnits(ptDate: string, units: number): void {
      q.addQuota.run(ptDate, units)
      const [y, m, d] = ptDate.split('-').map(Number) as [number, number, number]
      q.pruneQuota.run(new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10))
    },
    quotaUnitsUsed(ptDate: string): number {
      return (q.getQuota.get(ptDate) as { units: number } | undefined)?.units ?? 0
    },
    /** Record that a scan started. */
    startRun(run: {
      id: string
      schedulerId: string
      trigger: 'manual' | 'scheduled'
      startedAt: Date
    }): void {
      q.insertRun.run(run.id, run.schedulerId, run.trigger, run.startedAt.getTime())
    },
    /** Record how a scan ended, and trim history to the newest MAX_RUNS. */
    finishRun(
      id: string,
      r: {
        status: Exclude<RunStatus, 'running'>
        finishedAt: Date
        addedCount: number
        error?: { kind: string; message: string }
        details?: RunDetails
      },
    ): void {
      q.finishRun.run({
        id,
        status: r.status,
        finished_at: r.finishedAt.getTime(),
        added_count: r.addedCount,
        error_kind: r.error?.kind ?? null,
        error_message: r.error?.message ?? null,
        details_json: r.details ? JSON.stringify(r.details) : null,
      })
      q.pruneRuns.run(MAX_RUNS)
    },
    /** Newest first; all schedulers, or one. */
    listRuns(opts: { schedulerId?: string; limit?: number } = {}): RunView[] {
      const limit = opts.limit ?? 100
      const rows = opts.schedulerId
        ? q.listRunsFor.all(opts.schedulerId, limit)
        : q.listRuns.all(limit)
      return (rows as unknown as RunRow[]).map(toRun)
    },
    /** Runs left "running" by a crash or quit are marked as interrupted. */
    markInterruptedRuns(at: Date): void {
      q.interrupt.run(at.getTime())
    },
    /**
     * Development aid: make every channel of a scheduler count uploads since
     * `since`, and forget the last success so the cursor starts there.
     */
    debugLookback(schedulerId: string, since: Date): void {
      q.lookbackChannels.run(since.getTime(), schedulerId)
      q.clearLastSuccess.run(schedulerId)
    },
    /** Run `fn` in a transaction (all or nothing). */
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

export type SqliteStorage = ReturnType<typeof createSqliteStorage>
