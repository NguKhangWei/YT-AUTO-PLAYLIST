import { DatabaseSync } from 'node:sqlite'

/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many
 * have run. Never edit a shipped migration; append a new one.
 * Times are stored as epoch milliseconds (INTEGER).
 */
export const MIGRATIONS: string[] = [
  // 1: schedulers, tracked channels, handled videos
  `
  CREATE TABLE schedulers (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    playlist_id     TEXT NOT NULL UNIQUE,
    playlist_title  TEXT NOT NULL,
    interval_days   INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 30),
    time_of_day     TEXT NOT NULL,
    timezone        TEXT NOT NULL,
    active          INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at      INTEGER NOT NULL,
    last_success_at INTEGER,
    next_run_at     INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE channels (
    channel_id          TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    handle              TEXT,
    thumbnail_url       TEXT,
    subscriber_count    INTEGER,
    uploads_playlist_id TEXT NOT NULL
  ) STRICT;

  CREATE TABLE scheduler_channels (
    scheduler_id TEXT NOT NULL REFERENCES schedulers (id) ON DELETE CASCADE,
    channel_id   TEXT NOT NULL REFERENCES channels (channel_id),
    since_at     INTEGER NOT NULL,
    PRIMARY KEY (scheduler_id, channel_id)
  ) STRICT;

  -- Videos a scheduler has added, skipped for good (Shorts, streams) or found
  -- already in its playlist. Never re-checked.
  CREATE TABLE handled_videos (
    scheduler_id TEXT NOT NULL REFERENCES schedulers (id) ON DELETE CASCADE,
    video_id     TEXT NOT NULL,
    handled_at   INTEGER NOT NULL,
    PRIMARY KEY (scheduler_id, video_id)
  ) STRICT, WITHOUT ROWID;
  `,
  // 2: channel search cache, API quota used per Pacific-time day
  `
  CREATE TABLE search_cache (
    query        TEXT PRIMARY KEY,
    results_json TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE quota_usage (
    pt_date TEXT PRIMARY KEY,
    units   INTEGER NOT NULL
  ) STRICT;
  `,
  // 3: scan history
  `
  CREATE TABLE runs (
    id            TEXT PRIMARY KEY,
    scheduler_id  TEXT NOT NULL REFERENCES schedulers (id) ON DELETE CASCADE,
    trigger       TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
    status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'error')),
    started_at    INTEGER NOT NULL,
    finished_at   INTEGER,
    added_count   INTEGER NOT NULL DEFAULT 0,
    error_kind    TEXT,
    error_message TEXT,
    -- Added videos, skipped videos, unavailable channels, quota warning (JSON).
    details_json  TEXT
  ) STRICT;

  CREATE INDEX runs_by_scheduler ON runs (scheduler_id, started_at DESC);
  CREATE INDEX runs_by_time ON runs (started_at DESC);
  `,
]

/** Run pending migrations, each in its own transaction. */
export function migrate(db: DatabaseSync): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database schema v${current} is newer than this app (v${MIGRATIONS.length}). Update the app.`,
    )
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

/** Open (or create) the app database and bring its schema up to date. Use ':memory:' in tests. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  return db
}
