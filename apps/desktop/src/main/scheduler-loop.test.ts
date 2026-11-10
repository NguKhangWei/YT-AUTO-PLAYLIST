import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { createSchedulerLoop, TICK_MS } from './scheduler-loop'
import { scheduler } from './test/fixtures'

// 2026-11-10T00:00Z is 08:00 in Malaysia Time.
const START = new Date('2026-11-10T00:00:00Z')
const at = (iso: string) => new Date(iso)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})
afterEach(() => vi.useRealTimers())

function setup(opts: { signedIn?: boolean } = {}) {
  const storage = createSqliteStorage(openDatabase(':memory:'))
  const runner = { run: vi.fn(async () => ({}) as never) }
  const notify = vi.fn()
  const onChange = vi.fn()
  let signedIn = opts.signedIn ?? true
  const loop = createSchedulerLoop({
    storage,
    runner,
    now: () => new Date(),
    isSignedIn: async () => signedIn,
    notify,
    onChange,
  })
  const add = (id: string, nextRunAt: string, over = {}) =>
    storage.insertScheduler(
      scheduler(id, { playlistId: `PL-${id}`, nextRunAt: at(nextRunAt), ...over }),
    )
  const nextRun = async (id: string) => (await storage.getScheduler(id))?.nextRunAt.toISOString()
  return {
    storage,
    runner,
    notify,
    onChange,
    loop,
    add,
    nextRun,
    signIn: () => (signedIn = true),
  }
}

describe('scheduler loop', () => {
  it('does nothing before a scheduler is due', async () => {
    const t = setup()
    t.add('a', '2026-11-10T01:00:00Z') // 09:00 MYT
    expect(await t.loop.tick()).toEqual([])
    expect(t.runner.run).not.toHaveBeenCalled()
  })

  it('starts a due scan and moves the next run to the following slot', async () => {
    const t = setup()
    t.add('a', '2026-11-09T01:00:00Z', { intervalDays: 2 }) // due since yesterday 09:00
    expect(await t.loop.tick()).toEqual(['a'])
    expect(t.runner.run).toHaveBeenCalledWith('a', 'scheduled')
    expect(await t.nextRun('a')).toBe('2026-11-11T01:00:00.000Z')
    expect(t.onChange).toHaveBeenCalled()
  })

  it('catches up many missed slots with ONE scan, staying on the cadence', async () => {
    const t = setup()
    // Every 3 days from Oct 31 09:00 MYT; the PC was off until Nov 10 08:00 MYT.
    t.add('a', '2026-10-31T01:00:00Z', { intervalDays: 3 })
    expect(await t.loop.tick()).toEqual(['a'])
    expect(t.runner.run).toHaveBeenCalledTimes(1)
    // Slots: Oct 31, Nov 3, 6, 9 (missed) → next Nov 12 09:00 MYT.
    expect(await t.nextRun('a')).toBe('2026-11-12T01:00:00.000Z')
    expect(await t.loop.tick()).toEqual([])
  })

  it('ignores inactive schedulers', async () => {
    const t = setup()
    t.add('a', '2026-11-09T01:00:00Z', { active: false })
    expect(await t.loop.tick()).toEqual([])
  })

  it('fires on time without waiting for the 60 s tick', async () => {
    const t = setup()
    t.add('a', '2026-11-10T00:00:20Z') // due in 20 s
    t.loop.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.runner.run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(11_000)
    expect(t.runner.run).toHaveBeenCalledWith('a', 'scheduled')
    t.loop.stop()
  })

  it('keeps checking every minute and picks up schedulers added later', async () => {
    const t = setup()
    t.loop.start()
    await vi.advanceTimersByTimeAsync(TICK_MS + 1000)
    t.add('a', '2026-11-10T00:01:30Z')
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(t.runner.run).toHaveBeenCalledWith('a', 'scheduled')
    t.loop.stop()
  })

  it('stops when stopped', async () => {
    const t = setup()
    t.add('a', '2026-11-10T00:00:30Z')
    t.loop.start()
    t.loop.stop()
    await vi.advanceTimersByTimeAsync(2 * TICK_MS)
    expect(t.runner.run).not.toHaveBeenCalled()
  })

  describe('paused', () => {
    it('starts nothing while paused, and resuming runs what is due', async () => {
      const t = setup()
      t.add('a', '2026-11-09T01:00:00Z')
      t.loop.setPaused(true)
      expect(t.loop.isPaused()).toBe(true)
      expect(await t.loop.tick()).toEqual([])

      t.loop.start()
      t.loop.setPaused(false)
      await vi.waitFor(() => expect(t.runner.run).toHaveBeenCalledWith('a', 'scheduled'))
      t.loop.stop()
    })

    it('remembers pause across restarts', () => {
      const t = setup()
      t.loop.setPaused(true)
      const again = createSchedulerLoop({
        storage: t.storage,
        runner: t.runner,
        now: () => new Date(),
        isSignedIn: async () => true,
        notify: vi.fn(),
        onChange: vi.fn(),
      })
      expect(again.isPaused()).toBe(true)
    })
  })

  describe('signed out', () => {
    it('keeps due scans waiting, says so once, and runs them after sign-in', async () => {
      const t = setup({ signedIn: false })
      t.add('a', '2026-11-09T01:00:00Z')
      expect(await t.loop.tick()).toEqual([])
      expect(await t.loop.tick()).toEqual([])
      expect(t.notify).toHaveBeenCalledOnce()
      expect(t.notify.mock.calls[0]![0].title).toMatch(/waiting for you to sign in/)
      expect(await t.nextRun('a')).toBe('2026-11-09T01:00:00.000Z') // not consumed

      t.signIn()
      expect(await t.loop.tick()).toEqual(['a'])
    })

    it('does not nag when nothing is due', async () => {
      const t = setup({ signedIn: false })
      t.add('a', '2026-11-11T01:00:00Z')
      await t.loop.tick()
      expect(t.notify).not.toHaveBeenCalled()
    })
  })

  it('shares one check between overlapping triggers (e.g. resume + timer)', async () => {
    const t = setup()
    t.add('a', '2026-11-09T01:00:00Z')
    const [x, y] = await Promise.all([t.loop.tick(), t.loop.tick()])
    expect(x).toEqual(['a'])
    expect(y).toEqual(['a'])
    expect(t.runner.run).toHaveBeenCalledTimes(1)
  })

  it('keeps going when a scan fails to start', async () => {
    const t = setup()
    const log = vi.fn()
    const loop = createSchedulerLoop({
      storage: t.storage,
      runner: { run: vi.fn(async () => Promise.reject(new Error('boom'))) },
      now: () => new Date(),
      isSignedIn: async () => true,
      notify: vi.fn(),
      onChange: vi.fn(),
      log,
    })
    t.add('a', '2026-11-09T01:00:00Z')
    t.add('b', '2026-11-09T01:00:00Z')
    expect(await loop.tick()).toEqual(['a', 'b'])
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2))
  })
})
