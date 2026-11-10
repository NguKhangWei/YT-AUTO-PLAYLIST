import type { ScanStorage, SchedulerRecord, TrackedChannel } from '../ports'

/**
 * In-memory `ScanStorage`, for tests and as the reference behaviour every
 * real storage must match (see `@auto-yt/core/testing`). Returns copies so
 * callers can't mutate stored state by accident.
 */
export function createMemoryStorage() {
  const schedulers = new Map<string, SchedulerRecord>()
  const channels = new Map<string, TrackedChannel[]>()
  const added = new Map<string, Map<string, Date>>()

  const copySched = (s: SchedulerRecord): SchedulerRecord => ({ ...s })

  const storage: ScanStorage = {
    async getScheduler(id) {
      const s = schedulers.get(id)
      return s ? copySched(s) : null
    },
    async listTrackedChannels(schedulerId) {
      return (channels.get(schedulerId) ?? []).map((t) => ({
        channel: { ...t.channel },
        sinceAt: t.sinceAt,
      }))
    },
    async listAddedVideoIds(schedulerId) {
      return new Set(added.get(schedulerId)?.keys())
    },
    async recordAddedVideo(schedulerId, videoId, at) {
      let videos = added.get(schedulerId)
      if (!videos) added.set(schedulerId, (videos = new Map()))
      if (!videos.has(videoId)) videos.set(videoId, at)
    },
    async setLastSuccessAt(schedulerId, at) {
      const s = schedulers.get(schedulerId)
      if (s) s.lastSuccessAt = at
    },
    async setActive(schedulerId, active) {
      const s = schedulers.get(schedulerId)
      if (s) s.active = active
    },
  }

  return {
    ...storage,
    // --- Test setup helpers (not part of ScanStorage) ---
    putScheduler(s: SchedulerRecord) {
      schedulers.set(s.id, copySched(s))
    },
    trackChannel(schedulerId: string, tracked: TrackedChannel) {
      const list = channels.get(schedulerId) ?? []
      channels.set(schedulerId, [
        ...list.filter((t) => t.channel.id !== tracked.channel.id),
        tracked,
      ])
    },
  }
}

export type MemoryStorage = ReturnType<typeof createMemoryStorage>
