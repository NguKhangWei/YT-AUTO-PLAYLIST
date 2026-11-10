// Test data builders.
import type { SchedulerRecord, TrackedChannel } from '../db/sqlite-storage'

export const scheduler = (id: string, over: Partial<SchedulerRecord> = {}): SchedulerRecord => ({
  id,
  name: `Scheduler ${id}`,
  playlistId: `PL-${id}`,
  playlistTitle: `Playlist ${id}`,
  intervalDays: 1,
  timeOfDay: '09:00',
  timezone: 'Asia/Kuala_Lumpur',
  active: true,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  nextRunAt: new Date('2026-11-02T01:00:00Z'),
  ...over,
})

export const tracked = (
  id: string,
  sinceAt = new Date('2026-11-01T00:00:00Z'),
): TrackedChannel => ({
  channel: {
    id,
    title: `Channel ${id}`,
    handle: `@${id.toLowerCase()}`,
    uploadsPlaylistId: id.replace(/^UC/, 'UU'),
  },
  sinceAt,
})
