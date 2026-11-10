/** "Every day" / "Every 3 days". */
export function intervalLabel(days: number): string {
  return days === 1 ? 'Every day' : `Every ${days} days`
}

/**
 * A scan time in the scheduler's own zone, e.g. "Wed, 11 Nov, 09:00".
 * Shown with the zone name next to it, so it reads the same on any PC.
 */
export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

/** All IANA zones the runtime knows, with the default first. */
export function timeZones(defaultZone: string): string[] {
  const all = Intl.supportedValuesOf('timeZone')
  return [defaultZone, ...all.filter((z) => z !== defaultZone)]
}

/** "1.2M subscribers", or undefined when the channel hides its count. */
export function formatSubscribers(count: number | undefined): string | undefined {
  if (count === undefined) return undefined
  const n = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(count)
  return `${n} ${count === 1 ? 'subscriber' : 'subscribers'}`
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatRelative(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}

/** A timestamp in the viewer's local time, e.g. "10 Nov, 14:05". */
export function formatLocal(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}
