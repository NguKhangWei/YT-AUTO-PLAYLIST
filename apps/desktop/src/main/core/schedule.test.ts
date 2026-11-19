import { describe, expect, it } from 'vitest'
import { nextRunIfDue, nextSlotAfter, validateMinute } from './schedule'

const at = (iso: string) => new Date(iso)
const iso = (d: Date | null) => d?.toISOString()

describe('validateMinute', () => {
  it.each([0, 30, 59])('accepts %s', (m) => {
    expect(validateMinute(m)).toEqual([])
  })

  it.each([-1, 60, 1.5, Number.NaN])('rejects %s', (m) => {
    expect(validateMinute(m)).toEqual(['Minute must be a whole number from 0 to 59.'])
  })
})

describe('nextSlotAfter', () => {
  it('is later this hour when the minute has not passed yet', () => {
    expect(iso(nextSlotAfter(30, at('2026-11-10T01:10:00Z')))).toBe('2026-11-10T01:30:00.000Z')
  })

  it('is next hour when the minute has passed, or is exactly now', () => {
    expect(iso(nextSlotAfter(30, at('2026-11-10T01:45:00Z')))).toBe('2026-11-10T02:30:00.000Z')
    expect(iso(nextSlotAfter(30, at('2026-11-10T01:30:00Z')))).toBe('2026-11-10T02:30:00.000Z')
    expect(iso(nextSlotAfter(0, at('2026-11-10T01:00:00.001Z')))).toBe('2026-11-10T02:00:00.000Z')
  })

  it('rolls over the day, month and year', () => {
    expect(iso(nextSlotAfter(15, at('2026-12-31T23:50:00Z')))).toBe('2027-01-01T00:15:00.000Z')
  })

  it('always lands at the minute, within the next hour (randomized)', () => {
    let seed = 42
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (let i = 0; i < 2000; i++) {
      const now = new Date(Date.UTC(2026, 0, 1) + Math.floor(rand() * 400 * 86_400_000))
      const minute = Math.floor(rand() * 60)
      const slot = nextSlotAfter(minute, now)
      expect(slot.getTime()).toBeGreaterThan(now.getTime())
      expect(slot.getTime() - now.getTime()).toBeLessThanOrEqual(3_600_000)
      expect([slot.getUTCMinutes(), slot.getUTCSeconds(), slot.getUTCMilliseconds()]).toEqual([
        minute,
        0,
        0,
      ])
    }
  })
})

describe('nextRunIfDue', () => {
  it('is null before the scheduled time', () => {
    expect(nextRunIfDue(30, at('2026-11-10T01:30:00Z'), at('2026-11-10T01:29:59Z'))).toBeNull()
  })

  it('is due at the scheduled time, with the next run an hour later', () => {
    expect(iso(nextRunIfDue(30, at('2026-11-10T01:30:00Z'), at('2026-11-10T01:30:00Z')))).toBe(
      '2026-11-10T02:30:00.000Z',
    )
  })

  it('catches up any number of missed hours with one scan, back on the hourly cadence', () => {
    // Off from 01:30 until 07:10: five slots missed → one scan now, next at 07:30.
    expect(iso(nextRunIfDue(30, at('2026-11-10T01:30:00Z'), at('2026-11-10T07:10:00Z')))).toBe(
      '2026-11-10T07:30:00.000Z',
    )
  })
})
