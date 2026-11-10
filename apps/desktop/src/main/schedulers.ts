import { randomUUID } from 'node:crypto'
import { firstRunAt, validateSchedule, type Channel, type SchedulerRecord } from '@auto-yt/core'
import type { SchedulerInput, SchedulerView } from '../shared/api'
import type { SqliteStorage } from './db/sqlite-storage'

/** An error the user can fix (shown as-is in the editor). */
export class ValidationError extends Error {
  override readonly name = 'ValidationError'
  readonly kind = 'validation'
}

export const MAX_NAME_LENGTH = 80
/** Each tracked channel costs at least 1 API unit per scan. */
export const MAX_CHANNELS = 100

const CHANNEL_ID = /^UC[\w-]{22}$/
const UPLOADS_ID = /^UU[\w-]{22}$/

/** Keep only well-formed channels (as returned by search), without duplicates. */
function cleanChannels(raw: unknown): Channel[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new ValidationError('Channels must be a list.')
  const seen = new Map<string, Channel>()
  for (const c of raw as Partial<Channel>[]) {
    if (typeof c?.id !== 'string' || !CHANNEL_ID.test(c.id)) continue
    if (typeof c.uploadsPlaylistId !== 'string' || !UPLOADS_ID.test(c.uploadsPlaylistId)) continue
    seen.set(c.id, {
      id: c.id,
      title: String(c.title ?? c.id),
      uploadsPlaylistId: c.uploadsPlaylistId,
      ...(typeof c.handle === 'string' ? { handle: c.handle } : {}),
      ...(typeof c.thumbnailUrl === 'string' && c.thumbnailUrl.startsWith('https://')
        ? { thumbnailUrl: c.thumbnailUrl }
        : {}),
      ...(typeof c.subscriberCount === 'number' ? { subscriberCount: c.subscriberCount } : {}),
    })
  }
  return [...seen.values()]
}

/** Scheduler CRUD with validation, used by the IPC layer. */
export function createSchedulerService(deps: { storage: SqliteStorage; now: () => Date }) {
  const { storage } = deps

  async function toView(s: SchedulerRecord): Promise<SchedulerView> {
    const tracked = await storage.listTrackedChannels(s.id)
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
      channels: tracked.map((t) => t.channel),
      lastRun: storage.listRuns({ schedulerId: s.id, limit: 1 })[0],
    }
  }

  /** Validate and keep only the input fields (IPC input is never trusted to have just those). */
  function clean(raw: SchedulerInput): SchedulerInput {
    const input: SchedulerInput = {
      name: String(raw?.name ?? ''),
      playlistId: String(raw?.playlistId ?? ''),
      playlistTitle: String(raw?.playlistTitle ?? ''),
      intervalDays: Number(raw?.intervalDays),
      timeOfDay: String(raw?.timeOfDay ?? ''),
      timezone: String(raw?.timezone ?? ''),
      channels: cleanChannels(raw?.channels),
    }
    const name = input.name.trim()
    const errors: string[] = []
    if (!name) errors.push('Give the scheduler a name.')
    if (name.length > MAX_NAME_LENGTH)
      errors.push(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`)
    if (!input.playlistId) errors.push('Choose a playlist.')
    if (input.channels.length > MAX_CHANNELS)
      errors.push(`A scheduler can track at most ${MAX_CHANNELS} channels.`)
    errors.push(...validateSchedule(input))
    if (errors.length > 0) throw new ValidationError(errors.join(' '))
    return { ...input, name }
  }

  function assertPlaylistFree(playlistId: string, exceptId?: string): void {
    const owner = storage.schedulerIdForPlaylist(playlistId)
    if (owner && owner !== exceptId) {
      const other = storage.listSchedulers().find((s) => s.id === owner)
      throw new ValidationError(
        `That playlist is already used by "${other?.name ?? 'another scheduler'}". Each scheduler needs its own playlist.`,
      )
    }
  }

  /**
   * Make the scheduler track exactly `channels`. Channels already tracked keep
   * their start date; new ones only count uploads from `now` on.
   */
  async function syncChannels(id: string, channels: Channel[], now: Date): Promise<() => void> {
    const current = new Map(
      (await storage.listTrackedChannels(id)).map((t) => [t.channel.id, t.sinceAt]),
    )
    return () => {
      for (const c of channels) storage.trackChannel(id, c, current.get(c.id) ?? now)
      const keep = new Set(channels.map((c) => c.id))
      for (const old of current.keys()) if (!keep.has(old)) storage.untrackChannel(id, old)
    }
  }

  async function get(id: string): Promise<SchedulerRecord> {
    const s = await storage.getScheduler(id)
    if (!s) throw new ValidationError('That scheduler no longer exists.')
    return s
  }

  return {
    async list(): Promise<SchedulerView[]> {
      return Promise.all(storage.listSchedulers().map(toView))
    },

    /** New schedulers are active and first run at the next occurrence of their time. */
    async create(input: SchedulerInput): Promise<SchedulerView> {
      const { channels, ...fields } = clean(input)
      assertPlaylistFree(fields.playlistId)
      const now = deps.now()
      const record: SchedulerRecord = {
        id: randomUUID(),
        ...fields,
        active: true,
        createdAt: now,
        nextRunAt: firstRunAt(fields, now),
      }
      const writeChannels = await syncChannels(record.id, channels, now)
      storage.transaction(() => {
        storage.insertScheduler(record)
        writeChannels()
      })
      return toView(record)
    },

    /** Changing interval, time or time zone restarts the cadence from the next occurrence. */
    async update(id: string, input: SchedulerInput): Promise<SchedulerView> {
      const { channels, ...fields } = clean(input)
      const existing = await get(id)
      assertPlaylistFree(fields.playlistId, id)
      const now = deps.now()
      const scheduleChanged =
        fields.intervalDays !== existing.intervalDays ||
        fields.timeOfDay !== existing.timeOfDay ||
        fields.timezone !== existing.timezone
      const record: SchedulerRecord = {
        ...existing,
        ...fields,
        nextRunAt: scheduleChanged ? firstRunAt(fields, now) : existing.nextRunAt,
      }
      const writeChannels = await syncChannels(id, channels, now)
      storage.transaction(() => {
        storage.saveScheduler(record)
        writeChannels()
      })
      return toView(record)
    },

    /** Turning a scheduler back on schedules its next run fresh; time spent off isn't caught up. */
    async setActive(id: string, active: boolean): Promise<SchedulerView> {
      const existing = await get(id)
      if (existing.active === active) return toView(existing)
      const record: SchedulerRecord = {
        ...existing,
        active,
        nextRunAt: active ? firstRunAt(existing, deps.now()) : existing.nextRunAt,
      }
      storage.saveScheduler(record)
      return toView(record)
    },

    async remove(id: string): Promise<void> {
      storage.deleteScheduler(id)
    },
  }
}

export type SchedulerService = ReturnType<typeof createSchedulerService>
