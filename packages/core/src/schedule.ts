import { DateTime } from 'luxon'
import { isValidTimeZone } from './timezone'

export const MIN_INTERVAL_DAYS = 1
export const MAX_INTERVAL_DAYS = 30

/** When a scheduler scans: every `intervalDays` days at `timeOfDay` (HH:mm) in `timezone`. */
export interface ScheduleSpec {
  intervalDays: number
  /** 24-hour wall-clock time, "HH:mm". */
  timeOfDay: string
  /** IANA time zone, e.g. "Asia/Kuala_Lumpur". */
  timezone: string
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Returns human-readable problems with `spec`; empty when valid. */
export function validateSchedule(spec: ScheduleSpec): string[] {
  const errors: string[] = []
  if (
    !Number.isInteger(spec.intervalDays) ||
    spec.intervalDays < MIN_INTERVAL_DAYS ||
    spec.intervalDays > MAX_INTERVAL_DAYS
  ) {
    errors.push(
      `Interval must be a whole number of days from ${MIN_INTERVAL_DAYS} to ${MAX_INTERVAL_DAYS}.`,
    )
  }
  if (!TIME_OF_DAY.test(spec.timeOfDay)) {
    errors.push('Time must be in 24-hour HH:mm format, e.g. 09:30.')
  }
  if (!isValidTimeZone(spec.timezone)) {
    errors.push(`Unknown time zone "${spec.timezone}".`)
  }
  return errors
}

function assertValid(spec: ScheduleSpec): void {
  const errors = validateSchedule(spec)
  if (errors.length > 0) throw new RangeError(errors.join(' '))
}

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const [hour, minute] = timeOfDay.split(':').map(Number) as [number, number]
  return { hour, minute }
}

/**
 * The scan instant on the calendar day `date` (in the spec's zone), at the
 * spec's wall-clock time. If that wall time doesn't exist (DST spring-forward
 * gap), Luxon moves it forward by the gap; an ambiguous fall-back time
 * resolves to one instant (Luxon picks the later, standard-time one), so it
 * still runs once. Each slot is computed from its own calendar day, so
 * the wall time never drifts.
 */
function slotOn(date: DateTime, spec: ScheduleSpec): DateTime {
  const { hour, minute } = parseTimeOfDay(spec.timeOfDay)
  return DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day, hour, minute },
    { zone: spec.timezone },
  )
}

/**
 * First scan for a newly created (or re-enabled / edited) scheduler: the next
 * occurrence of `timeOfDay` strictly after `from` — today if it hasn't passed
 * yet, otherwise tomorrow. Later scans follow every `intervalDays` from here.
 */
export function firstRunAt(spec: ScheduleSpec, from: Date): Date {
  assertValid(spec)
  const fromInZone = DateTime.fromJSDate(from, { zone: spec.timezone })
  let slot = slotOn(fromInZone, spec)
  if (slot.toMillis() <= from.getTime()) slot = slotOn(fromInZone.plus({ days: 1 }), spec)
  return slot.toJSDate()
}

/**
 * The earliest slot on the cadence anchored at `anchor` (a previous slot) that
 * is strictly after `now`. Slots are `anchor`'s calendar day + k × intervalDays.
 */
export function nextSlotAfter(spec: ScheduleSpec, anchor: Date, now: Date): Date {
  assertValid(spec)
  const anchorDay = DateTime.fromJSDate(anchor, { zone: spec.timezone }).startOf('day')
  const nowDay = DateTime.fromJSDate(now, { zone: spec.timezone }).startOf('day')
  const daysBetween = Math.round(nowDay.diff(anchorDay, 'days').days)
  // Start one cadence step before today's position, then walk forward.
  let k = Math.max(0, Math.floor(daysBetween / spec.intervalDays) - 1)
  for (;;) {
    const slot = slotOn(anchorDay.plus({ days: k * spec.intervalDays }), spec)
    if (slot.toMillis() > now.getTime()) return slot.toJSDate()
    k++
  }
}

export interface DueCheck {
  /** True when the scheduled slot has arrived (or was missed) and a scan should run now. */
  due: boolean
  /** How many slots passed without a scan (≥1 when due). Missed slots run once, not N times. */
  missedSlots: number
  /** What `next_run_at` becomes once this scan is done (unchanged when not due). */
  nextRunAt: Date
}

/**
 * Decide whether a scheduler whose next scan is `nextRunAt` should run at `now`.
 * However many slots were missed (PC off, app closed), it runs once and the
 * following run lands back on the original cadence.
 */
export function checkDue(spec: ScheduleSpec, nextRunAt: Date, now: Date): DueCheck {
  if (now.getTime() < nextRunAt.getTime()) {
    assertValid(spec)
    return { due: false, missedSlots: 0, nextRunAt }
  }
  const next = nextSlotAfter(spec, nextRunAt, now)
  const anchorDay = DateTime.fromJSDate(nextRunAt, { zone: spec.timezone }).startOf('day')
  const nextDay = DateTime.fromJSDate(next, { zone: spec.timezone }).startOf('day')
  const missedSlots = Math.round(nextDay.diff(anchorDay, 'days').days / spec.intervalDays)
  return { due: true, missedSlots, nextRunAt: next }
}
