// Dev aid: make a scheduler treat the last N days of uploads as new, so "Run now" has work.
// Usage: npm run debug:lookback -- "<scheduler name>" [days=7]
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [name, daysArg = '7'] = process.argv.slice(2)
const days = Number(daysArg)
if (!name || !Number.isInteger(days) || days < 1) {
  console.error('Usage: npm run debug:lookback -- "<scheduler name>" [days]')
  process.exit(1)
}

const dbPath = join(process.env.APPDATA ?? '', 'auto-yt', 'auto-yt.db')
if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Start the app once first.`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
const scheduler = db
  .prepare('SELECT id, name FROM schedulers WHERE name = ? COLLATE NOCASE')
  .get(name)
if (!scheduler) {
  const names = db.prepare('SELECT name FROM schedulers ORDER BY name').all()
  console.error(`No scheduler named "${name}". Schedulers: ${names.map((s) => s.name).join(', ')}`)
  process.exit(1)
}

const since = Date.now() - days * 86_400_000
db.prepare('UPDATE scheduler_channels SET since_at = ? WHERE scheduler_id = ?').run(
  since,
  scheduler.id,
)
db.prepare('UPDATE schedulers SET last_success_at = NULL WHERE id = ?').run(scheduler.id)
console.log(
  `"${scheduler.name}" now treats uploads from the last ${days} days as new. Use Run now.`,
)
