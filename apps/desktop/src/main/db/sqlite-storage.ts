import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Channel, ScanStorage, SchedulerRecord, TrackedChannel } from '@auto-yt/core'

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
