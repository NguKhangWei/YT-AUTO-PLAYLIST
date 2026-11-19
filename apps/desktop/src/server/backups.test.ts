import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../main/db/database'
import { createSqliteStorage } from '../main/db/sqlite-storage'
import { scheduler } from '../main/test/fixtures'
import { createBackups } from './backups'

let dir: string
let db: DatabaseSync
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'auto-yt-backup-'))
  db = openDatabase(join(dir, "it's auto-yt.db")) // a quote in the path, on purpose
  createSqliteStorage(db).insertScheduler(scheduler('a', { name: 'Fun' }))
})
afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('createBackups', () => {
  it("writes one readable backup per day, named by the day's date", async () => {
    let now = new Date('2026-11-20T03:00:00Z')
    const backups = createBackups({ db, dir: join(dir, 'backups'), now: () => now })
    const path = backups.runIfDue()
    expect(path).toBe(join(dir, 'backups', 'auto-yt-2026-11-20.db'))
    expect(backups.runIfDue()).toBeNull() // same day: nothing to do

    const copy = new DatabaseSync(path!, { readOnly: true })
    expect(copy.prepare('SELECT name FROM schedulers').all()).toEqual([{ name: 'Fun' }])
    copy.close()

    now = new Date('2026-11-21T00:00:01Z')
    expect(backups.runIfDue()).toBe(join(dir, 'backups', 'auto-yt-2026-11-21.db'))
  })

  it('keeps only the newest copies and leaves other files alone', async () => {
    const out = join(dir, 'backups')
    const backups = createBackups({
      db,
      dir: out,
      now: () => new Date('2026-11-20T00:00:00Z'),
      keep: 3,
    })
    backups.runIfDue() // creates the folder
    for (const day of ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']) {
      await writeFile(join(out, `auto-yt-${day}.db`), '')
    }
    await writeFile(join(out, 'notes.txt'), 'mine')
    await rm(join(out, 'auto-yt-2026-11-20.db'))
    backups.runIfDue()
    expect((await readdir(out)).sort()).toEqual([
      'auto-yt-2026-11-17.db',
      'auto-yt-2026-11-18.db',
      'auto-yt-2026-11-20.db',
      'notes.txt',
    ])
  })
})
