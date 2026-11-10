import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import {
  firstRunAt,
  isValidTimeZone,
  nextRunIfDue,
  nextSlotAfter,
  validateSchedule,
  type ScheduleSpec,
} from './schedule'

const KL = 'Asia/Kuala_Lumpur'
const DENVER = 'America/Denver'

/** Wall-clock ISO (no offset) in `zone` → Date. */
const at = (iso: string, zone = KL) => DateTime.fromISO(iso, { zone }).toJSDate()
/** Date → wall-clock "yyyy-MM-dd HH:mm" in `zone`, for readable assertions. */
const wall = (d: Date, zone = KL) => DateTime.fromJSDate(d, { zone }).toFormat('yyyy-MM-dd HH:mm')

const spec = (over: Partial<ScheduleSpec> = {}): ScheduleSpec => ({
  intervalDays: 1,
  timeOfDay: '09:00',
  timezone: KL,
  ...over,
})

describe('validateSchedule', () => {
  it('accepts valid specs at the interval bounds', () => {
    expect(validateSchedule(spec({ intervalDays: 1 }))).toEqual([])
    expect(validateSchedule(spec({ intervalDays: 30, timeOfDay: '23:59' }))).toEqual([])
    expect(validateSchedule(spec({ timeOfDay: '00:00', timezone: 'UTC' }))).toEqual([])
  })

  it.each([0, 31, 1.5, -2, Number.NaN])('rejects interval %s', (intervalDays) => {
    expect(validateSchedule(spec({ intervalDays }))).toHaveLength(1)
  })

  it.each(['9:00', '24:00', '12:60', '0900', '', '09:00:00'])('rejects time "%s"', (timeOfDay) => {
    expect(validateSchedule(spec({ timeOfDay }))).toHaveLength(1)
  })

  it('rejects unknown time zones and reports every problem', () => {
    expect(validateSchedule(spec({ timezone: 'Mars/Base' }))).toHaveLength(1)
    expect(validateSchedule({ intervalDays: 0, timeOfDay: 'x', timezone: 'nope' })).toHaveLength(3)
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects unknown or empty ones', () => {
    expect(isValidTimeZone('Asia/Kuala_Lumpur')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false)
    expect(isValidTimeZone('  ')).toBe(false)
  })
})

describe('firstRunAt', () => {
  it('is later today when the time has not passed yet (Malaysia Time)', () => {
    const first = firstRunAt(spec(), at('2026-11-10T08:00'))
    expect(wall(first)).toBe('2026-11-10 09:00')
    expect(first.toISOString()).toBe('2026-11-10T01:00:00.000Z') // KL is UTC+8
  })

  it('is tomorrow when the time has passed or is exactly now', () => {
    expect(wall(firstRunAt(spec(), at('2026-11-10T10:00')))).toBe('2026-11-11 09:00')
    expect(wall(firstRunAt(spec(), at('2026-11-10T09:00')))).toBe('2026-11-11 09:00')
  })

  it('does not depend on interval (first scan is always the next occurrence)', () => {
    expect(wall(firstRunAt(spec({ intervalDays: 7 }), at('2026-11-10T08:00')))).toBe(
      '2026-11-10 09:00',
    )
  })

  it('uses the scheduler zone, not UTC, to decide "today"', () => {
    // 2026-11-10 23:30 UTC is already 2026-11-11 07:30 in KL.
    const first = firstRunAt(spec(), new Date('2026-11-10T23:30:00Z'))
    expect(wall(first)).toBe('2026-11-11 09:00')
  })

  it('rolls over month and year ends', () => {
    expect(wall(firstRunAt(spec(), at('2026-11-30T10:00')))).toBe('2026-12-01 09:00')
    expect(wall(firstRunAt(spec(), at('2026-12-31T10:00')))).toBe('2027-01-01 09:00')
  })
})

describe('nextSlotAfter', () => {
  const anchor = at('2026-11-10T09:00')

  it('steps by the interval from the anchor', () => {
    const s = spec({ intervalDays: 3 })
    expect(wall(nextSlotAfter(s, anchor, at('2026-11-10T09:01')))).toBe('2026-11-13 09:00')
    expect(wall(nextSlotAfter(s, anchor, at('2026-11-12T23:59')))).toBe('2026-11-13 09:00')
    expect(wall(nextSlotAfter(s, anchor, at('2026-11-13T09:00')))).toBe('2026-11-16 09:00')
  })

  it('returns the anchor itself when now is before it', () => {
    expect(wall(nextSlotAfter(spec(), anchor, at('2026-11-01T00:00')))).toBe('2026-11-10 09:00')
  })

  it('crosses month and year boundaries on the cadence', () => {
    const s = spec({ intervalDays: 5 })
    expect(wall(nextSlotAfter(s, at('2026-12-30T09:00'), at('2026-12-30T10:00')))).toBe(
      '2027-01-04 09:00',
    )
    const monthly = spec({ intervalDays: 30 })
    expect(wall(nextSlotAfter(monthly, at('2027-01-31T09:00'), at('2027-02-01T00:00')))).toBe(
      '2027-03-02 09:00',
    )
  })

  it('stays on the cadence far into the future', () => {
    const s = spec({ intervalDays: 7 })
    // 52 weeks after 2026-11-10 is 2027-11-09.
    expect(wall(nextSlotAfter(s, anchor, at('2027-11-08T12:00')))).toBe('2027-11-09 09:00')
  })
})

describe('daylight saving (America/Denver)', () => {
  const den = (iso: string) => at(iso, DENVER)
  const wallDen = (d: Date) => wall(d, DENVER)

  it('keeps the wall-clock time across spring-forward (UTC offset changes)', () => {
    // DST starts 2027-03-14 02:00 MST → 03:00 MDT.
    const s = spec({ timezone: DENVER })
    const before = nextSlotAfter(s, den('2027-03-13T09:00'), den('2027-03-12T12:00'))
    const after = nextSlotAfter(s, den('2027-03-13T09:00'), den('2027-03-13T10:00'))
    expect(wallDen(before)).toBe('2027-03-13 09:00')
    expect(before.toISOString()).toBe('2027-03-13T16:00:00.000Z') // MST, UTC-7
    expect(wallDen(after)).toBe('2027-03-14 09:00')
    expect(after.toISOString()).toBe('2027-03-14T15:00:00.000Z') // MDT, UTC-6
  })

  it('moves a time inside the spring-forward gap forward, then returns to normal', () => {
    const s = spec({ timezone: DENVER, timeOfDay: '02:30' })
    const inGap = nextSlotAfter(s, den('2027-03-13T02:30'), den('2027-03-13T03:00'))
    expect(wallDen(inGap)).toBe('2027-03-14 03:30') // 02:30 doesn't exist that day
    const nextDay = nextSlotAfter(s, den('2027-03-13T02:30'), inGap)
    expect(wallDen(nextDay)).toBe('2027-03-15 02:30')
  })

  it('runs an ambiguous fall-back time once, at the later instant', () => {
    // DST ends 2027-11-07 02:00 MDT → 01:00 MST, so 01:30 happens twice.
    const s = spec({ timezone: DENVER, timeOfDay: '01:30' })
    const slot = nextSlotAfter(s, den('2027-11-06T01:30'), den('2027-11-06T02:00'))
    expect(slot.toISOString()).toBe('2027-11-07T08:30:00.000Z') // 01:30 MST, UTC-7
    const following = nextSlotAfter(s, den('2027-11-06T01:30'), slot)
    expect(wallDen(following)).toBe('2027-11-08 01:30')
  })
})

describe('nextRunIfDue (catch-up)', () => {
  const nextRunAt = at('2026-11-10T09:00')

  it('is null before the slot', () => {
    expect(nextRunIfDue(spec(), nextRunAt, at('2026-11-10T08:59'))).toBeNull()
  })

  it('is due exactly at the slot, and returns the following one', () => {
    expect(wall(nextRunIfDue(spec({ intervalDays: 2 }), nextRunAt, at('2026-11-10T09:00'))!)).toBe(
      '2026-11-12 09:00',
    )
  })

  it('runs many missed slots only once and stays on the original cadence', () => {
    // Every 3 days from Nov 10: Nov 10, 13, 16, 19 all passed by Nov 20 noon.
    const next = nextRunIfDue(spec({ intervalDays: 3 }), nextRunAt, at('2026-11-20T12:00'))
    expect(wall(next!)).toBe('2026-11-22 09:00')
  })

  it('picks a slot later the same day after a long gap', () => {
    // PC off from Nov 10 until Nov 15 08:00; today's 09:00 hasn't passed yet.
    expect(wall(nextRunIfDue(spec(), nextRunAt, at('2026-11-15T08:00'))!)).toBe('2026-11-15 09:00')
  })
})

describe('nextSlotAfter invariants (seeded random cases)', () => {
  // Small deterministic PRNG (mulberry32) so failures are reproducible.
  let seed = 12345
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
  const pad = (n: number) => String(n).padStart(2, '0')

  it('returns the first slot after now, on the cadence, at the wall time', () => {
    for (const timezone of [KL, 'UTC', 'Asia/Tokyo']) {
      for (let i = 0; i < 2000 / 3; i++) {
        const s = spec({
          timezone,
          intervalDays: int(1, 30),
          timeOfDay: `${pad(int(0, 23))}:${pad(int(0, 59))}`,
        })
        const anchor = firstRunAt(s, new Date(Date.UTC(2026, 0, 1) + int(0, 365) * 86_400_000))
        const now = new Date(anchor.getTime() + int(-5, 400) * 3_600_000 * 24 * rand())
        const next = nextSlotAfter(s, anchor, now)

        const nextWall = DateTime.fromJSDate(next, { zone: timezone })
        const anchorWall = DateTime.fromJSDate(anchor, { zone: timezone })
        const days = Math.round(
          nextWall.startOf('day').diff(anchorWall.startOf('day'), 'days').days,
        )

        expect(next.getTime()).toBeGreaterThan(now.getTime())
        expect(nextWall.toFormat('HH:mm')).toBe(s.timeOfDay)
        expect(days % s.intervalDays).toBe(0)
        // The previous slot on the cadence is not after now (we didn't skip one).
        if (days > 0) {
          const prev = nextWall.minus({ days: s.intervalDays })
          expect(prev.toMillis()).toBeLessThanOrEqual(now.getTime())
        }
      }
    }
  })
})
