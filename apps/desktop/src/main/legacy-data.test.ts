import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateLegacyData } from './legacy-data'

let root: string
let from: string
let to: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'auto-yt-legacy-'))
  from = join(root, '@auto-yt', 'desktop')
  to = join(root, 'auto-yt')
  mkdirSync(from, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const put = (dir: string, name: string, text: string) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), text)
}

describe('migrateLegacyData', () => {
  it('copies the sign-in and database into the new folder once', () => {
    put(from, 'auth.bin', 'secret')
    put(from, 'auto-yt.db', 'db')
    put(from, 'auto-yt.db-wal', 'wal')
    put(from, 'Preferences', 'chromium stuff, not copied')

    expect(migrateLegacyData(from, to)).toEqual(['auth.bin', 'auto-yt.db', 'auto-yt.db-wal'])
    expect(readFileSync(join(to, 'auth.bin'), 'utf8')).toBe('secret')
    expect(readFileSync(join(from, 'auto-yt.db'), 'utf8')).toBe('db') // old copy kept

    put(from, 'auto-yt.db', 'newer old data')
    expect(migrateLegacyData(from, to)).toEqual([]) // never twice
    expect(readFileSync(join(to, 'auto-yt.db'), 'utf8')).toBe('db')
  })

  it('never overwrites a database already in the new folder', () => {
    put(from, 'auto-yt.db', 'old')
    put(to, 'auto-yt.db', 'current')
    expect(migrateLegacyData(from, to)).toEqual([])
    expect(readFileSync(join(to, 'auto-yt.db'), 'utf8')).toBe('current')
  })

  it('does nothing without old data, or when both folders are the same', () => {
    expect(migrateLegacyData(from, to)).toEqual([])
    put(from, 'auto-yt.db', 'x')
    expect(migrateLegacyData(from, from)).toEqual([])
  })

  it('copies a sign-in even if no database was created yet', () => {
    put(from, 'auth.bin', 'secret')
    expect(migrateLegacyData(from, to)).toEqual(['auth.bin'])
  })
})
