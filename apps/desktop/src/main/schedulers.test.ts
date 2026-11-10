import { describe, expect, it, vi } from 'vitest'
import type { SchedulerInput } from '../shared/api'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { createSchedulerService } from './schedulers'
import { tracked } from './test/fixtures'

const input = (over: Partial<SchedulerInput> = {}): SchedulerInput => ({
  name: 'Gaming',
  playlistId: 'PL1',
  playlistTitle: 'Gaming videos',
  intervalDays: 1,
  timeOfDay: '09:00',
  timezone: 'Asia/Kuala_Lumpur',
  channels: [],
  ...over,
})

function setup(nowIso = '2026-11-10T00:00:00Z') {
  // 2026-11-10T00:00Z is 08:00 in Malaysia Time.
  let now = new Date(nowIso)
  const storage = createSqliteStorage(openDatabase(':memory:'))
  const service = createSchedulerService({ storage, now: () => now })
  return { storage, service, setNow: (iso: string) => (now = new Date(iso)) }
}

describe('create', () => {
  it('saves an active scheduler whose first run is the next occurrence of its time', async () => {
    const { service } = setup()
    const s = await service.create(input({ name: '  Gaming  ' }))
    expect(s).toMatchObject({
      name: 'Gaming',
      active: true,
      createdAt: '2026-11-10T00:00:00.000Z',
      nextRunAt: '2026-11-10T01:00:00.000Z', // 09:00 MYT today
      channels: [],
    })
    expect(s.lastSuccessAt).toBeUndefined()
    expect(await service.list()).toEqual([s])
  })

  it.each([
    [{ name: '   ' }, /name/],
    [{ name: 'x'.repeat(81) }, /80 characters/],
    [{ playlistId: '' }, /playlist/],
    [{ intervalDays: 0 }, /1 to 30/],
    [{ timeOfDay: '25:00' }, /HH:mm/],
    [{ timezone: 'Mars/Base' }, /time zone/],
  ])('rejects %o', async (over, message) => {
    const { service } = setup()
    expect(() => service.create(input(over))).toThrow(message)
  })

  it('allows only one scheduler per playlist, naming the one using it', async () => {
    const { service } = setup()
    await service.create(input({ name: 'Gaming' }))
    expect(() => service.create(input({ name: 'Other' }))).toThrow('already used by "Gaming"')
  })
})

describe('update', () => {
  it('keeps the next run when only the name or playlist changes', async () => {
    const t = setup()
    const s = await t.service.create(input())
    t.setNow('2026-11-10T00:30:00Z')
    const u = await t.service.update(
      s.id,
      input({ name: 'Games', playlistId: 'PL9', playlistTitle: 'New' }),
    )
    expect(u).toMatchObject({
      name: 'Games',
      playlistId: 'PL9',
      playlistTitle: 'New',
      nextRunAt: s.nextRunAt,
    })
  })

  it('restarts the cadence when interval, time or time zone change', async () => {
    const t = setup()
    const s = await t.service.create(input())
    t.setNow('2026-11-10T02:00:00Z') // 10:00 MYT: 09:00 today has passed
    expect((await t.service.update(s.id, input({ intervalDays: 3 }))).nextRunAt).toBe(
      '2026-11-11T01:00:00.000Z',
    )
    expect(
      (await t.service.update(s.id, input({ intervalDays: 3, timeOfDay: '18:30' }))).nextRunAt,
    ).toBe('2026-11-10T10:30:00.000Z')
    expect(
      (
        await t.service.update(
          s.id,
          input({ intervalDays: 3, timeOfDay: '18:30', timezone: 'UTC' }),
        )
      ).nextRunAt,
    ).toBe('2026-11-10T18:30:00.000Z')
  })

  it('may keep its own playlist but not take another scheduler’s', () => {
    const { service } = setup()
    const a = service.create(input({ name: 'A', playlistId: 'PL-A' }))
    service.create(input({ name: 'B', playlistId: 'PL-B' }))
    expect(() => service.update(a.id, input({ name: 'A2', playlistId: 'PL-A' }))).not.toThrow()
    expect(() => service.update(a.id, input({ name: 'A', playlistId: 'PL-B' }))).toThrow('"B"')
  })

  it('reports a scheduler that was deleted meanwhile', () => {
    const { service } = setup()
    expect(() => service.update('gone', input())).toThrow('no longer exists')
  })

  it('ignores extra fields sent with the input (e.g. a whole SchedulerView)', () => {
    const { service } = setup()
    const s = service.create(input())
    const u = service.update(s.id, { ...s, name: 'Edited', createdAt: 'not a date' } as never)
    expect(u).toMatchObject({ name: 'Edited', createdAt: s.createdAt })
  })
})

describe('setActive', () => {
  it('turning off keeps the schedule; turning on schedules the next occurrence from now', () => {
    const t = setup()
    const s = t.service.create(input())
    expect(t.service.setActive(s.id, false)).toMatchObject({
      active: false,
      nextRunAt: s.nextRunAt,
    })

    t.setNow('2026-11-15T03:00:00Z') // 11:00 MYT, days later
    const on = t.service.setActive(s.id, true)
    expect(on).toMatchObject({ active: true, nextRunAt: '2026-11-16T01:00:00.000Z' })
    expect(t.service.setActive(s.id, true)).toEqual(on) // no-op
  })
})

describe('remove and list', () => {
  it('deletes a scheduler and lists tracked channels with each scheduler', () => {
    const { service, storage } = setup()
    const a = service.create(input({ name: 'A', playlistId: 'PL-A' }))
    const b = service.create(input({ name: 'B', playlistId: 'PL-B' }))
    const t = tracked('UC1')
    storage.trackChannel(b.id, t.channel, t.sinceAt)

    service.remove(a.id)
    const list = service.list()
    expect(list.map((s) => s.name)).toEqual(['B'])
    expect(list[0]?.channels).toEqual([t.channel])
  })

  it('tells the app after every change', () => {
    const onChange = vi.fn()
    const service = createSchedulerService({
      storage: createSqliteStorage(openDatabase(':memory:')),
      now: () => new Date('2026-11-10T00:00:00Z'),
      onChange,
    })
    const s = service.create(input())
    service.update(s.id, input({ name: 'Renamed' }))
    service.setActive(s.id, false)
    service.remove(s.id)
    expect(onChange).toHaveBeenCalledTimes(4)
  })
})

describe('tracked channels', () => {
  const ch = (n: number) => ({
    id: `UC${String(n).padStart(22, '0')}`,
    title: `Channel ${n}`,
    uploadsPlaylistId: `UU${String(n).padStart(22, '0')}`,
  })
  const sinceById = (t: ReturnType<typeof setup>, id: string) =>
    Object.fromEntries(
      t.storage.listTrackedChannels(id).map((x) => [x.channel.id, x.sinceAt.toISOString()]),
    )

  it('tracks channels from creation; new ones count uploads from the moment they are saved', () => {
    const t = setup()
    const s = t.service.create(input({ channels: [ch(1)] }))
    expect(s.channels.map((c) => c.id)).toEqual([ch(1).id])

    t.setNow('2026-11-12T00:00:00Z')
    t.service.update(s.id, input({ channels: [ch(1), ch(2)] }))
    expect(sinceById(t, s.id)).toEqual({
      [ch(1).id]: '2026-11-10T00:00:00.000Z', // kept
      [ch(2).id]: '2026-11-12T00:00:00.000Z', // new
    })
  })

  it('untracks removed channels, and re-adding starts fresh', () => {
    const t = setup()
    const s = t.service.create(input({ channels: [ch(1), ch(2)] }))
    t.setNow('2026-11-11T00:00:00Z')
    expect(t.service.update(s.id, input({ channels: [ch(2)] })).channels.map((c) => c.id)).toEqual([
      ch(2).id,
    ])
    t.setNow('2026-11-12T00:00:00Z')
    t.service.update(s.id, input({ channels: [ch(1), ch(2)] }))
    expect(sinceById(t, s.id)[ch(1).id]).toBe('2026-11-12T00:00:00.000Z')
  })

  it('lets two schedulers track the same channel independently', () => {
    const t = setup()
    const a = t.service.create(input({ name: 'A', playlistId: 'PL-A', channels: [ch(1)] }))
    const b = t.service.create(input({ name: 'B', playlistId: 'PL-B', channels: [ch(1)] }))
    t.service.update(a.id, input({ name: 'A', playlistId: 'PL-A', channels: [] }))
    expect(t.service.list().find((x) => x.id === b.id)?.channels).toHaveLength(1)
  })

  it('drops duplicate channels and non-https avatars', () => {
    const { service } = setup()
    const s = service.create(
      input({
        channels: [
          ch(1),
          { ...ch(1), title: 'dup' },
          { ...ch(2), thumbnailUrl: 'javascript:alert(1)' },
        ],
      }),
    )
    expect(s.channels).toHaveLength(2) // listed by title, so compare without order
    expect(s.channels).toEqual(expect.arrayContaining([{ ...ch(1), title: 'dup' }, ch(2)]))
  })

  it('limits a scheduler to 100 channels', () => {
    const { service } = setup()
    const many = Array.from({ length: 101 }, (_, i) => ch(i))
    expect(() => service.create(input({ channels: many }))).toThrow('at most 100')
  })

  it('saves nothing when the scheduler is invalid (all or nothing)', () => {
    const t = setup()
    t.service.create(input({ name: 'A', channels: [ch(1)] }))
    expect(() => t.service.create(input({ name: 'B', channels: [ch(2)] }))).toThrow()
    expect(t.service.list()).toHaveLength(1)
  })
})
