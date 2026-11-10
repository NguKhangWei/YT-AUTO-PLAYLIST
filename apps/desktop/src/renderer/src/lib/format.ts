// Text formatting for the window.
import { plural } from '../../../shared/format'

export { formatInZone } from '../../../shared/format'

export function intervalLabel(days: number): string {
  return days === 1 ? 'Every day' : `Every ${days} days`
}

/** Every IANA time zone, with `first` at the top. */
export function timeZones(first: string): string[] {
  return [first, ...Intl.supportedValuesOf('timeZone').filter((z) => z !== first)]
}

/** "1.3M subscribers", or undefined when the count is hidden. */
export function formatSubscribers(count: number | undefined): string | undefined {
  if (count === undefined) return undefined
  const n = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
  return `${n.format(count)} ${count === 1 ? 'subscriber' : 'subscribers'}`
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatRelative(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return `${plural(Math.floor(s / 86_400), 'day')} ago`
}

/** Local time, e.g. "10 Nov, 14:05". */
export function formatLocal(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}
