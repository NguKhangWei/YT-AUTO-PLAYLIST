// One-time copy of data from the pre-M10 folder (%APPDATA%/@auto-yt/desktop). Remove once run.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DATA_FILES = ['auth.bin', 'auto-yt.db', 'auto-yt.db-wal', 'auto-yt.db-shm']

/** Copies the sign-in and database to `toDir` if it has no database yet; returns the files copied. */
export function migrateLegacyData(fromDir: string, toDir: string): string[] {
  if (fromDir === toDir || existsSync(join(toDir, 'auto-yt.db'))) return []
  const present = DATA_FILES.filter((name) => existsSync(join(fromDir, name)))
  if (!present.includes('auto-yt.db') && !present.includes('auth.bin')) return []
  mkdirSync(toDir, { recursive: true })
  for (const name of present) copyFileSync(join(fromDir, name), join(toDir, name))
  return present
}
