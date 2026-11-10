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
