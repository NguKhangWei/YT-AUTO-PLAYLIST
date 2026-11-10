import { contractChannel } from '@auto-yt/core/testing'
import { describe, expect, it } from 'vitest'
import type { SchedulerInput } from '../shared/api'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { createSchedulerService } from './schedulers'

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
    await expect(service.create(input(over))).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringMatching(message),
    })
  })

  it('allows only one scheduler per playlist, naming the one using it', async () => {
    const { service } = setup()
    await service.create(input({ name: 'Gaming' }))
    await expect(service.create(input({ name: 'Other' }))).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringContaining('already used by "Gaming"'),
    })
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

  it('may keep its own playlist but not take another scheduler’s', async () => {
    const { service } = setup()
    const a = await service.create(input({ name: 'A', playlistId: 'PL-A' }))
    await service.create(input({ name: 'B', playlistId: 'PL-B' }))
    await expect(
      service.update(a.id, input({ name: 'A2', playlistId: 'PL-A' })),
    ).resolves.toBeTruthy()
    await expect(
      service.update(a.id, input({ name: 'A', playlistId: 'PL-B' })),
    ).rejects.toMatchObject({
      message: expect.stringContaining('"B"'),
    })
  })

  it('reports a scheduler that was deleted meanwhile', async () => {
    const { service } = setup()
    await expect(service.update('gone', input())).rejects.toMatchObject({ kind: 'validation' })
  })
})

describe('setActive', () => {
  it('turning off keeps the schedule; turning on schedules the next occurrence from now', async () => {
    const t = setup()
    const s = await t.service.create(input())
    const off = await t.service.setActive(s.id, false)
    expect(off).toMatchObject({ active: false, nextRunAt: s.nextRunAt })

    t.setNow('2026-11-15T03:00:00Z') // 11:00 MYT, days later
    const on = await t.service.setActive(s.id, true)
    expect(on).toMatchObject({ active: true, nextRunAt: '2026-11-16T01:00:00.000Z' })
    expect(await t.service.setActive(s.id, true)).toEqual(on) // no-op
  })
})

describe('remove and list', () => {
  it('deletes a scheduler and lists tracked channels with each scheduler', async () => {
    const { service, storage } = setup()
    const a = await service.create(input({ name: 'A', playlistId: 'PL-A' }))
    const b = await service.create(input({ name: 'B', playlistId: 'PL-B' }))
    const t = contractChannel('UC1')
    storage.trackChannel(b.id, t.channel, t.sinceAt)

    await service.remove(a.id)
    const list = await service.list()
    expect(list.map((s) => s.name)).toEqual(['B'])
    expect(list[0]?.channels).toEqual([t.channel])
  })
})

describe('input hygiene', () => {
  it('ignores extra fields sent over IPC (e.g. a whole SchedulerView)', async () => {
    const { service } = setup()
    const s = await service.create(input())
    const u = await service.update(s.id, {
      ...s,
      name: 'Edited',
      createdAt: 'not a date',
      channels: [{ bogus: true }],
    } as never)
    expect(u.createdAt).toBe(s.createdAt)
    expect(u.name).toBe('Edited')
    expect(u.channels).toEqual([])
  })

  it('rejects missing fields with a validation error, not a crash', async () => {
    const { service } = setup()
    await expect(service.create({} as never)).rejects.toMatchObject({ kind: 'validation' })
  })
})

describe('tracked channels', () => {
  const ch = (n: number) => ({
    id: `UC${String(n).padStart(22, '0')}`,
    title: `Channel ${n}`,
    uploadsPlaylistId: `UU${String(n).padStart(22, '0')}`,
  })

  it('tracks channels from creation; new ones count uploads from the moment they are saved', async () => {
    const t = setup()
    const s = await t.service.create(input({ channels: [ch(1)] }))
    expect(s.channels.map((c) => c.id)).toEqual([ch(1).id])

    t.setNow('2026-11-12T00:00:00Z')
    await t.service.update(s.id, input({ channels: [ch(1), ch(2)] }))
    const since = Object.fromEntries(
      (await t.storage.listTrackedChannels(s.id)).map((x) => [
        x.channel.id,
        x.sinceAt.toISOString(),
      ]),
    )
    expect(since).toEqual({
      [ch(1).id]: '2026-11-10T00:00:00.000Z', // kept
      [ch(2).id]: '2026-11-12T00:00:00.000Z', // new
    })
  })

  it('untracks removed channels, and re-adding starts fresh', async () => {
    const t = setup()
    const s = await t.service.create(input({ channels: [ch(1), ch(2)] }))
    t.setNow('2026-11-11T00:00:00Z')
    const u = await t.service.update(s.id, input({ channels: [ch(2)] }))
    expect(u.channels.map((c) => c.id)).toEqual([ch(2).id])
    t.setNow('2026-11-12T00:00:00Z')
    await t.service.update(s.id, input({ channels: [ch(1), ch(2)] }))
    const tracked = await t.storage.listTrackedChannels(s.id)
    expect(tracked.find((x) => x.channel.id === ch(1).id)?.sinceAt.toISOString()).toBe(
      '2026-11-12T00:00:00.000Z',
    )
  })

  it('lets two schedulers track the same channel independently', async () => {
    const t = setup()
    const a = await t.service.create(input({ name: 'A', playlistId: 'PL-A', channels: [ch(1)] }))
    const b = await t.service.create(input({ name: 'B', playlistId: 'PL-B', channels: [ch(1)] }))
    await t.service.update(a.id, input({ name: 'A', playlistId: 'PL-A', channels: [] }))
    expect((await t.service.list()).find((x) => x.id === b.id)?.channels).toHaveLength(1)
  })

  it('drops malformed channels and duplicates, and keeps only https avatars', async () => {
    const { service } = setup()
    const s = await service.create(
      input({
        channels: [
          ch(1),
          { ...ch(1), title: 'dup' },
          { id: 'not-a-channel', title: 'x', uploadsPlaylistId: 'UUx' },
          { ...ch(2), thumbnailUrl: 'javascript:alert(1)' },
        ],
      }),
    )
    // Listed by title, so compare without order.
    expect(s.channels).toHaveLength(2)
    expect(s.channels).toEqual(expect.arrayContaining([{ ...ch(1), title: 'dup' }, ch(2)]))
  })

  it('limits a scheduler to 100 channels', async () => {
    const { service } = setup()
    const many = Array.from({ length: 101 }, (_, i) => ch(i))
    await expect(service.create(input({ channels: many }))).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringContaining('at most 100'),
    })
  })

  it('saves nothing when the scheduler is invalid (all or nothing)', async () => {
    const t = setup()
    await t.service.create(input({ name: 'A', channels: [ch(1)] }))
    await expect(t.service.create(input({ name: 'B', channels: [ch(2)] }))).rejects.toThrow()
    expect(await t.service.list()).toHaveLength(1)
  })
})
