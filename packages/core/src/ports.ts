import type { Channel } from './youtube/types'

/** A scheduler as the scan engine sees it. */
export interface SchedulerRecord {
  id: string
  name: string
  /** Target playlist. Unique across schedulers. */
  playlistId: string
  playlistTitle: string
  intervalDays: number
  timeOfDay: string
  timezone: string
  active: boolean
  createdAt: Date
  /** Start time of the last scan that finished completely. Undefined before the first one. */
  lastSuccessAt?: Date
  nextRunAt: Date
}

/** A channel tracked by a scheduler. */
export interface TrackedChannel {
  channel: Channel
  /** Only videos published at or after this count as new (when the channel was added). */
  sinceAt: Date
}

/**
 * Persistence the scan needs. Async so it can be backed by SQLite in the
 * desktop app (M6) or Cloudflare D1 later. M6 extends this with scheduler CRUD.
 */
export interface ScanStorage {
  getScheduler(id: string): Promise<SchedulerRecord | null>
  listTrackedChannels(schedulerId: string): Promise<TrackedChannel[]>
  /** Video ids this scheduler has already added (or found already in its playlist). */
  listAddedVideoIds(schedulerId: string): Promise<Set<string>>
  /** Remember a video as handled for this scheduler. Idempotent. */
  recordAddedVideo(schedulerId: string, videoId: string, at: Date): Promise<void>
  /** Called only after a scan finished completely. */
  setLastSuccessAt(schedulerId: string, at: Date): Promise<void>
  setActive(schedulerId: string, active: boolean): Promise<void>
}
