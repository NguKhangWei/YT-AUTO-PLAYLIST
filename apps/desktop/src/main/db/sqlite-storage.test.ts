import {
  describeScanStorageContract,
  contractChannel,
  contractScheduler,
} from '@auto-yt/core/testing'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase } from './database'
import { createSqliteStorage } from './sqlite-storage'

// Same behaviour as the in-memory reference storage.
describeScanStorageContract('sqlite', () => {
  const storage = createSqliteStorage(openDatabase(':memory:'))
  return {
    storage,
    putScheduler: (s) => storage.insertScheduler(s),
    trackChannel: (id, t) => storage.trackChannel(id, t.channel, t.sinceAt),
  }
})

describe('migrations', () => {
  it('brings a new database to the latest version and is idempotent', () => {
    const db = openDatabase(':memory:')
    const version = () =>
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    expect(version()).toBe(MIGRATIONS.length)
    migrate(db)
    expect(version()).toBe(MIGRATIONS.length)
  })

  it('refuses a database from a newer app version', () => {
    const db = openDatabase(':memory:')
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    expect(() => migrate(db)).toThrow(/newer than this app/)
  })
})

describe('sqlite storage', () => {
  const setup = () => createSqliteStorage(openDatabase(':memory:'))

  it('enforces one scheduler per playlist', () => {
    const s = setup()
    s.insertScheduler(contractScheduler('a', { playlistId: 'PL1' }))
    expect(s.schedulerIdForPlaylist('PL1')).toBe('a')
    expect(s.schedulerIdForPlaylist('PL2')).toBeUndefined()
    expect(() => s.insertScheduler(contractScheduler('b', { playlistId: 'PL1' }))).toThrow(
      /UNIQUE constraint failed: schedulers.playlist_id/,
    )
  })

  it('rejects intervals outside 1–30 days at the database level', () => {
    const s = setup()
    expect(() => s.insertScheduler(contractScheduler('a', { intervalDays: 31 }))).toThrow(/CHECK/)
  })

  it('lists schedulers oldest first and saves edits', () => {
    const s = setup()
    s.insertScheduler(contractScheduler('b', { playlistId: 'PL-b', createdAt: new Date(2000) }))
    s.insertScheduler(contractScheduler('a', { playlistId: 'PL-a', createdAt: new Date(1000) }))
    expect(s.listSchedulers().map((x) => x.id)).toEqual(['a', 'b'])

    const edited = { ...s.listSchedulers()[0]!, name: 'Renamed', intervalDays: 7 }
    s.saveScheduler(edited)
    expect(s.listSchedulers()[0]).toEqual(edited)
  })

  it('deletes a scheduler with its channel links and history', async () => {
    const s = setup()
    s.insertScheduler(contractScheduler('a'))
    const t = contractChannel('UC1')
    s.trackChannel('a', t.channel, t.sinceAt)
    await s.recordAddedVideo('a', 'v1', new Date())
    s.deleteScheduler('a')
    expect(await s.getScheduler('a')).toBeNull()
    expect(await s.listTrackedChannels('a')).toEqual([])
    expect(await s.listAddedVideoIds('a')).toEqual(new Set())
  })

  it('keeps channel details up to date and untracks', async () => {
    const s = setup()
    s.insertScheduler(contractScheduler('a'))
    const { channel } = contractChannel('UC1')
    s.trackChannel('a', channel, new Date(1000))
    s.trackChannel('a', { ...channel, title: 'New name', subscriberCount: 5 }, new Date(2000))
    expect(await s.listTrackedChannels('a')).toEqual([
      { channel: { ...channel, title: 'New name', subscriberCount: 5 }, sinceAt: new Date(2000) },
    ])
    s.untrackChannel('a', 'UC1')
    expect(await s.listTrackedChannels('a')).toEqual([])
  })

  it('rolls back a failed transaction', () => {
    const s = setup()
    expect(() =>
      s.transaction(() => {
        s.insertScheduler(contractScheduler('a', { playlistId: 'PL1' }))
        s.insertScheduler(contractScheduler('b', { playlistId: 'PL1' }))
      }),
    ).toThrow()
    expect(s.listSchedulers()).toEqual([])
  })
})

describe('search cache', () => {
  const ch = contractChannel('UC1').channel

  it('returns fresh entries only, and prunes old ones on write', () => {
    const s = createSqliteStorage(openDatabase(':memory:'))
    s.putCachedSearch('linus', [ch], new Date(1000), new Date(0))
    expect(s.getCachedSearch('linus', new Date(500))).toEqual([ch])
    expect(s.getCachedSearch('linus', new Date(1001))).toBeUndefined()
    expect(s.getCachedSearch('other', new Date(0))).toBeUndefined()

    s.putCachedSearch('new', [], new Date(5000), new Date(2000)) // prunes 'linus'
    expect(s.getCachedSearch('linus', new Date(0))).toBeUndefined()
    expect(s.getCachedSearch('new', new Date(0))).toEqual([])
  })
})

describe('quota usage', () => {
  it('sums units per day and forgets days older than 30', () => {
    const s = createSqliteStorage(openDatabase(':memory:'))
    s.addQuotaUnits('2026-10-01', 7)
    s.addQuotaUnits('2026-11-10', 100)
    s.addQuotaUnits('2026-11-10', 50)
    expect(s.quotaUnitsUsed('2026-11-10')).toBe(150)
    expect(s.quotaUnitsUsed('2026-11-11')).toBe(0)
    expect(s.quotaUnitsUsed('2026-10-01')).toBe(0) // pruned by the Nov 10 write
  })
})

describe('upgrading an existing database', () => {
  it('upgrades a v1 (M6) database to the latest version without losing schedulers', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(MIGRATIONS[0]!)
    db.exec('PRAGMA user_version = 1')
    // Plain SQL: the storage itself needs the latest schema (the app always migrates first).
    db.exec(`INSERT INTO schedulers VALUES ('old', 'Scheduler old', 'PL-old', 'Playlist old',
      1, '09:00', 'Asia/Kuala_Lumpur', 1, 0, NULL, 0)`)

    migrate(db)
    const s = createSqliteStorage(db)
    expect((await s.getScheduler('old'))?.name).toBe('Scheduler old')
    expect(s.quotaUnitsUsed('2026-11-10')).toBe(0) // v2 tables exist
  })
})

describe('run history', () => {
  const setup = () => {
    const s = createSqliteStorage(openDatabase(':memory:'))
    s.insertScheduler(contractScheduler('a', { playlistId: 'PL-a', name: 'A' }))
    s.insertScheduler(contractScheduler('b', { playlistId: 'PL-b', name: 'B' }))
    return s
  }

  it('records a run from start to finish, newest first, with the scheduler name', () => {
    const s = setup()
    s.startRun({ id: 'r1', schedulerId: 'a', trigger: 'manual', startedAt: new Date(1000) })
    expect(s.listRuns()[0]).toEqual({
      id: 'r1',
      schedulerId: 'a',
      schedulerName: 'A',
      trigger: 'manual',
      status: 'running',
      startedAt: new Date(1000).toISOString(),
      addedCount: 0,
    })
    const details = {
      added: [{ id: 'v', title: 'T', publishedAt: new Date(0).toISOString() }],
      skipped: [],
      unavailableChannels: [],
      quotaWarning: false,
      deactivated: false,
    }
    s.finishRun('r1', {
      status: 'partial',
      finishedAt: new Date(2000),
      addedCount: 1,
      error: { kind: 'quotaExceeded', message: 'q' },
      details,
    })
    s.startRun({ id: 'r2', schedulerId: 'b', trigger: 'scheduled', startedAt: new Date(3000) })

    expect(s.listRuns().map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(s.listRuns({ schedulerId: 'a' })).toEqual([
      expect.objectContaining({
        status: 'partial',
        finishedAt: new Date(2000).toISOString(),
        addedCount: 1,
        error: { kind: 'quotaExceeded', message: 'q' },
        details,
      }),
    ])
    expect(s.listRuns({ limit: 1 })).toHaveLength(1)
  })

  it('marks runs left running by a crash as interrupted', () => {
    const s = setup()
    s.startRun({ id: 'r1', schedulerId: 'a', trigger: 'manual', startedAt: new Date(1000) })
    s.markInterruptedRuns(new Date(5000))
    expect(s.listRuns()[0]).toMatchObject({ status: 'error', error: { kind: 'interrupted' } })
  })

  it('keeps only the newest 500 runs', () => {
    const s = setup()
    for (let i = 0; i < 502; i++) {
      s.startRun({ id: `r${i}`, schedulerId: 'a', trigger: 'manual', startedAt: new Date(i) })
    }
    s.finishRun('r501', { status: 'ok', finishedAt: new Date(600), addedCount: 0 })
    const runs = s.listRuns({ limit: 1000 })
    expect(runs).toHaveLength(500)
    expect(runs.at(-1)?.id).toBe('r2')
  })

  it('deletes a scheduler’s runs with it', () => {
    const s = setup()
    s.startRun({ id: 'r1', schedulerId: 'a', trigger: 'manual', startedAt: new Date(1000) })
    s.deleteScheduler('a')
    expect(s.listRuns()).toEqual([])
  })

  it('debug lookback moves every channel start back and clears the last success', async () => {
    const s = setup()
    const t = contractChannel('UC1', new Date('2026-11-10T00:00:00Z'))
    s.trackChannel('a', t.channel, t.sinceAt)
    await s.setLastSuccessAt('a', new Date('2026-11-10T01:00:00Z'))
    s.debugLookback('a', new Date('2026-11-03T00:00:00Z'))
    expect((await s.listTrackedChannels('a'))[0]?.sinceAt).toEqual(new Date('2026-11-03T00:00:00Z'))
    expect((await s.getScheduler('a'))?.lastSuccessAt).toBeUndefined()
  })
})

describe('settings and next run', () => {
  it('stores JSON settings with a fallback', () => {
    const s = createSqliteStorage(openDatabase(':memory:'))
    expect(s.getSetting('paused', false)).toBe(false)
    s.setSetting('paused', true)
    expect(s.getSetting('paused', false)).toBe(true)
    s.setSetting('paused', false)
    expect(s.getSetting('paused', true)).toBe(false)
  })

  it('moves only the next run time', async () => {
    const s = createSqliteStorage(openDatabase(':memory:'))
    s.insertScheduler(contractScheduler('a', { name: 'Keep me' }))
    s.setNextRunAt('a', new Date('2026-12-01T01:00:00Z'))
    expect(await s.getScheduler('a')).toMatchObject({
      name: 'Keep me',
      nextRunAt: new Date('2026-12-01T01:00:00Z'),
    })
  })
})
