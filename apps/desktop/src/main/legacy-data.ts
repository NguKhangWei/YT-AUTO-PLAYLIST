import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Files that make up the app's data: the sign-in and the database (with its WAL files). */
export const DATA_FILES = ['auth.bin', 'auto-yt.db', 'auto-yt.db-wal', 'auto-yt.db-shm']

/**
 * Builds before M10 stored data in %APPDATA%/@auto-yt/desktop; the app now uses
 * %APPDATA%/auto-yt (shared by `npm run dev` and the installed app). Copy the
 * old files over once, when the new folder has no database yet. The old folder
 * is left as it was. Returns the names of the files copied.
 */
export function migrateLegacyData(fromDir: string, toDir: string): string[] {
  if (fromDir === toDir) return []
  if (existsSync(join(toDir, 'auto-yt.db'))) return []
  if (!existsSync(join(fromDir, 'auto-yt.db')) && !existsSync(join(fromDir, 'auth.bin'))) {
    return []
  }
  mkdirSync(toDir, { recursive: true })
  const copied: string[] = []
  for (const name of DATA_FILES) {
    const from = join(fromDir, name)
    if (!existsSync(from)) continue
    copyFileSync(from, join(toDir, name))
    copied.push(name)
  }
  return copied
}
