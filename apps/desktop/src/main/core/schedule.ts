// Schedule maths: every scheduler scans once an hour, at its minute past the hour.
// Minutes are counted in UTC, so the desktop and a cloud server agree on every slot;
// in whole-hour time zones (e.g. Malaysia Time) that's the same minute on the clock.

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

/** Readable problems with a minute of the hour; empty when it's valid. */
export function validateMinute(minuteOfHour: number): string[] {
  return Number.isInteger(minuteOfHour) && minuteOfHour >= 0 && minuteOfHour <= 59
    ? []
    : ['Minute must be a whole number from 0 to 59.']
}

/** The first hh:MM slot strictly after `now`, at `minuteOfHour` past the hour. */
export function nextSlotAfter(minuteOfHour: number, now: Date): Date {
  const t = now.getTime()
  const slot = t - (t % HOUR_MS) + minuteOfHour * MINUTE_MS
  return new Date(slot > t ? slot : slot + HOUR_MS)
}

/**
 * If a scan scheduled for `nextRunAt` is due at `now`, the time of the scan
 * after it; otherwise null. Any number of missed hours means a single scan.
 */
export function nextRunIfDue(minuteOfHour: number, nextRunAt: Date, now: Date): Date | null {
  return now.getTime() < nextRunAt.getTime() ? null : nextSlotAfter(minuteOfHour, now)
}
