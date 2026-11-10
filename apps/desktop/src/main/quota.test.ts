import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { createQuotaTracker } from './quota'

describe('quota tracker', () => {
  it('counts units per Pacific-time day, pushes changes, and resets at midnight PT', () => {
    let now = new Date('2026-11-10T03:00:00Z') // 11:00 MYT, still Nov 9 in PT
    const onChange = vi.fn()
    const storage = createSqliteStorage(openDatabase(':memory:'))
    const quota = createQuotaTracker({ storage, now: () => now, onChange })

    quota.record(100)
    quota.record(1)
    expect(quota.status()).toEqual({
      used: 101,
      limit: 10_000,
      resetsAt: '2026-11-10T08:00:00.000Z',
    })
    expect(onChange).toHaveBeenLastCalledWith(quota.status())
    expect(quota.remaining()).toBe(9_899)

    now = new Date('2026-11-10T08:00:00Z') // midnight PT: new quota day
    expect(quota.status().used).toBe(0)
  })

  it('never reports negative remaining units', () => {
    const storage = createSqliteStorage(openDatabase(':memory:'))
    const quota = createQuotaTracker({ storage, now: () => new Date(), limit: 100 })
    quota.record(150)
    expect(quota.remaining()).toBe(0)
  })
})
