// Schedule maths: when a scheduler's scans fall, in its own time zone.
import { DateTime } from 'luxon'
import { MAX_INTERVAL_DAYS, MIN_INTERVAL_DAYS } from '../../shared/constants'

export interface ScheduleSpec {
  intervalDays: number
  timeOfDay: string // "HH:mm", 24-hour
  timezone: string // IANA, e.g. "Asia/Kuala_Lumpur"
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

/** True if `tz` is an IANA time zone this runtime knows. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Readable problems with a schedule; empty when it's valid. */
export function validateSchedule(spec: ScheduleSpec): string[] {
  const errors: string[] = []
  const { intervalDays: days } = spec
  if (!Number.isInteger(days) || days < MIN_INTERVAL_DAYS || days > MAX_INTERVAL_DAYS) {
    errors.push(
      `Interval must be a whole number of days from ${MIN_INTERVAL_DAYS} to ${MAX_INTERVAL_DAYS}.`,
    )
  }
  if (!TIME_OF_DAY.test(spec.timeOfDay)) {
    errors.push('Time must be in 24-hour HH:mm format, e.g. 09:30.')
  }
  if (!isValidTimeZone(spec.timezone)) errors.push(`Unknown time zone "${spec.timezone}".`)
  return errors
}

/**
 * The scan time on `date`'s calendar day. Each slot is built from its own day,
 * so the wall-clock time never drifts across DST changes (a time skipped by a
 * DST gap moves forward; a repeated one resolves to a single instant).
 */
function slotOn(date: DateTime, spec: ScheduleSpec): DateTime {
  const [hour, minute] = spec.timeOfDay.split(':').map(Number) as [number, number]
  return DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day, hour, minute },
    { zone: spec.timezone },
  )
}

/** The next occurrence of the scan time strictly after `from` (today or tomorrow). */
export function firstRunAt(spec: ScheduleSpec, from: Date): Date {
  const today = DateTime.fromJSDate(from, { zone: spec.timezone })
  let slot = slotOn(today, spec)
  if (slot.toMillis() <= from.getTime()) slot = slotOn(today.plus({ days: 1 }), spec)
  return slot.toJSDate()
}

/** The first slot after `now` on the cadence "anchor's day + k × interval". */
export function nextSlotAfter(spec: ScheduleSpec, anchor: Date, now: Date): Date {
  const anchorDay = DateTime.fromJSDate(anchor, { zone: spec.timezone }).startOf('day')
  const nowDay = DateTime.fromJSDate(now, { zone: spec.timezone }).startOf('day')
  const daysBetween = Math.round(nowDay.diff(anchorDay, 'days').days)
  let k = Math.max(0, Math.floor(daysBetween / spec.intervalDays) - 1) // one step back, then walk
  for (;;) {
    const slot = slotOn(anchorDay.plus({ days: k * spec.intervalDays }), spec)
    if (slot.toMillis() > now.getTime()) return slot.toJSDate()
    k++
  }
}

/**
 * If a scan scheduled for `nextRunAt` is due at `now`, the time of the scan
 * after it; otherwise null. Any number of missed slots means a single scan.
 */
export function nextRunIfDue(spec: ScheduleSpec, nextRunAt: Date, now: Date): Date | null {
  return now.getTime() < nextRunAt.getTime() ? null : nextSlotAfter(spec, nextRunAt, now)
}
