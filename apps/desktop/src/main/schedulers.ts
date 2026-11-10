// Creating, editing, toggling and deleting schedulers, with validation.
import { randomUUID } from 'node:crypto'
import type { Channel, SchedulerInput, SchedulerView } from '../shared/api'
import { MAX_CHANNELS, MAX_NAME_LENGTH } from '../shared/constants'
import { firstRunAt, validateSchedule } from './core/schedule'
import type { SchedulerRecord, SqliteStorage } from './db/sqlite-storage'

/** Picks the input fields and checks them, throwing an Error with every problem found. */
function validate(input: SchedulerInput): SchedulerInput {
  const { playlistId, playlistTitle, intervalDays, timeOfDay, timezone } = input
  const name = input.name.trim()
  const channels = [...new Map(input.channels.map((c) => [c.id, c])).values()].map((c): Channel =>
    c.thumbnailUrl?.startsWith('https://') ? c : { ...c, thumbnailUrl: undefined },
  )
  const errors = validateSchedule({ intervalDays, timeOfDay, timezone })
  if (!name) errors.unshift('Give the scheduler a name.')
  if (name.length > MAX_NAME_LENGTH)
    errors.push(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`)
  if (!playlistId) errors.push('Choose a playlist.')
  if (channels.length > MAX_CHANNELS) {
    errors.push(`A scheduler can track at most ${MAX_CHANNELS} channels.`)
  }
  if (errors.length > 0) throw new Error(errors.join(' '))
  return { name, playlistId, playlistTitle, intervalDays, timeOfDay, timezone, channels }
}

/** Scheduler operations used by IPC; `onChange` runs after every change. */
export function createSchedulerService(deps: {
  storage: SqliteStorage
  now: () => Date
  onChange?: () => void
}) {
  const { storage } = deps

  function toView(s: SchedulerRecord): SchedulerView {
    return {
      id: s.id,
      name: s.name,
      playlistId: s.playlistId,
      playlistTitle: s.playlistTitle,
      intervalDays: s.intervalDays,
      timeOfDay: s.timeOfDay,
      timezone: s.timezone,
      active: s.active,
      createdAt: s.createdAt.toISOString(),
      lastSuccessAt: s.lastSuccessAt?.toISOString(),
      nextRunAt: s.nextRunAt.toISOString(),
      channels: storage.listTrackedChannels(s.id).map((t) => t.channel),
      lastRun: storage.listRuns({ schedulerId: s.id, limit: 1 })[0],
    }
  }

  function assertPlaylistFree(playlistId: string, exceptId?: string): void {
    const owner = storage.schedulerIdForPlaylist(playlistId)
    if (!owner || owner === exceptId) return
    const name = storage.getScheduler(owner)?.name ?? 'another scheduler'
    throw new Error(
      `That playlist is already used by "${name}". Each scheduler needs its own playlist.`,
    )
  }

  /** Tracks exactly `channels`; existing ones keep their start date, new ones start now. */
  function syncChannels(id: string, channels: Channel[], now: Date): void {
    const since = new Map(storage.listTrackedChannels(id).map((t) => [t.channel.id, t.sinceAt]))
    for (const c of channels) storage.trackChannel(id, c, since.get(c.id) ?? now)
    const keep = new Set(channels.map((c) => c.id))
    for (const old of since.keys()) if (!keep.has(old)) storage.untrackChannel(id, old)
  }

  function get(id: string): SchedulerRecord {
    const s = storage.getScheduler(id)
    if (!s) throw new Error('That scheduler no longer exists.')
    return s
  }

  /** Saves `record` and its channels in one transaction, then returns its view. */
  function save(
    record: SchedulerRecord,
    channels: Channel[] | null,
    isNew: boolean,
  ): SchedulerView {
    storage.transaction(() => {
      if (isNew) storage.insertScheduler(record)
      else storage.saveScheduler(record)
      if (channels) syncChannels(record.id, channels, deps.now())
    })
    deps.onChange?.()
    return toView(record)
  }

  return {
    list: (): SchedulerView[] => storage.listSchedulers().map(toView),

    /** New schedulers are active and first scan at the next occurrence of their time. */
    create(input: SchedulerInput): SchedulerView {
      const { channels, ...fields } = validate(input)
      assertPlaylistFree(fields.playlistId)
      const now = deps.now()
      return save(
        {
          id: randomUUID(),
          ...fields,
          active: true,
          createdAt: now,
          nextRunAt: firstRunAt(fields, now),
        },
        channels,
        true,
      )
    },

    /** Changing the interval, time or time zone restarts the schedule from the next occurrence. */
    update(id: string, input: SchedulerInput): SchedulerView {
      const { channels, ...fields } = validate(input)
      const existing = get(id)
      assertPlaylistFree(fields.playlistId, id)
      const rescheduled =
        fields.intervalDays !== existing.intervalDays ||
        fields.timeOfDay !== existing.timeOfDay ||
        fields.timezone !== existing.timezone
      const nextRunAt = rescheduled ? firstRunAt(fields, deps.now()) : existing.nextRunAt
      return save({ ...existing, ...fields, nextRunAt }, channels, false)
    },

    /** Turning a scheduler back on schedules it fresh; time spent off isn't caught up. */
    setActive(id: string, active: boolean): SchedulerView {
      const existing = get(id)
      if (existing.active === active) return toView(existing)
      const nextRunAt = active ? firstRunAt(existing, deps.now()) : existing.nextRunAt
      return save({ ...existing, active, nextRunAt }, null, false)
    },

    remove(id: string): void {
      storage.deleteScheduler(id)
      deps.onChange?.()
    },
  }
}

export type SchedulerService = ReturnType<typeof createSchedulerService>
