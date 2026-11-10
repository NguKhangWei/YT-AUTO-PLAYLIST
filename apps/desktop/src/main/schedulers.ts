import { randomUUID } from 'node:crypto'
import { firstRunAt, validateSchedule, type SchedulerRecord } from '@auto-yt/core'
import type { SchedulerInput, SchedulerView } from '../shared/api'
import type { SqliteStorage } from './db/sqlite-storage'

/** An error the user can fix (shown as-is in the editor). */
export class ValidationError extends Error {
  override readonly name = 'ValidationError'
  readonly kind = 'validation'
}

export const MAX_NAME_LENGTH = 80

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
    }
    const name = input.name.trim()
    const errors: string[] = []
    if (!name) errors.push('Give the scheduler a name.')
    if (name.length > MAX_NAME_LENGTH)
      errors.push(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`)
    if (!input.playlistId) errors.push('Choose a playlist.')
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
      const data = clean(input)
      assertPlaylistFree(data.playlistId)
      const now = deps.now()
      const record: SchedulerRecord = {
        id: randomUUID(),
        ...data,
        active: true,
        createdAt: now,
        nextRunAt: firstRunAt(data, now),
      }
      storage.insertScheduler(record)
      return toView(record)
    },

    /** Changing interval, time or time zone restarts the cadence from the next occurrence. */
    async update(id: string, input: SchedulerInput): Promise<SchedulerView> {
      const data = clean(input)
      const existing = await get(id)
      assertPlaylistFree(data.playlistId, id)
      const scheduleChanged =
        data.intervalDays !== existing.intervalDays ||
        data.timeOfDay !== existing.timeOfDay ||
        data.timezone !== existing.timezone
      const record: SchedulerRecord = {
        ...existing,
        ...data,
        nextRunAt: scheduleChanged ? firstRunAt(data, deps.now()) : existing.nextRunAt,
      }
      storage.saveScheduler(record)
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
