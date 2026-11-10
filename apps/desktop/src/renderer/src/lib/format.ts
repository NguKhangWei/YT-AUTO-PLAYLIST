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
