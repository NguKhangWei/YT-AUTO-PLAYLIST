import { describe, expect, it } from 'vitest'
import type { ScanStorage, SchedulerRecord, TrackedChannel } from '../ports'

/** A storage under test plus a way to seed it (each implementation seeds differently). */
export interface ContractSubject {
  storage: ScanStorage
  putScheduler(s: SchedulerRecord): Promise<void> | void
  trackChannel(schedulerId: string, t: TrackedChannel): Promise<void> | void
}

export const contractScheduler = (
  id: string,
  over: Partial<SchedulerRecord> = {},
): SchedulerRecord => ({
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

export const contractChannel = (
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

/**
 * Behaviour every `ScanStorage` must have. Run it from each implementation's
 * test file: `describeScanStorageContract('memory', () => subject)`.
 */
export function describeScanStorageContract(
  name: string,
  makeSubject: () => Promise<ContractSubject> | ContractSubject,
): void {
  describe(`ScanStorage contract: ${name}`, () => {
    it('returns null for an unknown scheduler', async () => {
      const { storage } = await makeSubject()
      expect(await storage.getScheduler('nope')).toBeNull()
    })

    it('round-trips a scheduler, including dates', async () => {
      const subject = await makeSubject()
      const s = contractScheduler('a', { lastSuccessAt: new Date('2026-11-03T04:05:06Z') })
      await subject.putScheduler(s)
      expect(await subject.storage.getScheduler('a')).toEqual(s)
    })

    it('lists tracked channels per scheduler only', async () => {
      const subject = await makeSubject()
      await subject.putScheduler(contractScheduler('a'))
      await subject.putScheduler(contractScheduler('b', { playlistId: 'PL-b' }))
      await subject.trackChannel('a', contractChannel('UC1'))
      await subject.trackChannel('a', contractChannel('UC2', new Date('2026-11-05T00:00:00Z')))
      await subject.trackChannel('b', contractChannel('UC1'))
      const a = await subject.storage.listTrackedChannels('a')
      expect(a.map((t) => t.channel.id).sort()).toEqual(['UC1', 'UC2'])
      expect(a.find((t) => t.channel.id === 'UC2')?.sinceAt).toEqual(
        new Date('2026-11-05T00:00:00Z'),
      )
      expect(await subject.storage.listTrackedChannels('b')).toHaveLength(1)
      expect(await subject.storage.listTrackedChannels('none')).toEqual([])
    })

    it('records handled videos per scheduler, idempotently', async () => {
      const subject = await makeSubject()
      await subject.putScheduler(contractScheduler('a'))
      await subject.putScheduler(contractScheduler('b', { playlistId: 'PL-b' }))
      const at = new Date('2026-11-05T00:00:00Z')
      await subject.storage.recordAddedVideo('a', 'v1', at)
      await subject.storage.recordAddedVideo('a', 'v1', at)
      await subject.storage.recordAddedVideo('a', 'v2', at)
      expect(await subject.storage.listAddedVideoIds('a')).toEqual(new Set(['v1', 'v2']))
      expect(await subject.storage.listAddedVideoIds('b')).toEqual(new Set())
    })

    it('updates lastSuccessAt and active', async () => {
      const subject = await makeSubject()
      await subject.putScheduler(contractScheduler('a'))
      const at = new Date('2026-11-06T00:00:00Z')
      await subject.storage.setLastSuccessAt('a', at)
      await subject.storage.setActive('a', false)
      expect(await subject.storage.getScheduler('a')).toMatchObject({
        lastSuccessAt: at,
        active: false,
      })
    })

    it('does not let callers mutate stored state through returned objects', async () => {
      const subject = await makeSubject()
      await subject.putScheduler(contractScheduler('a'))
      const got = await subject.storage.getScheduler('a')
      got!.active = false
      expect((await subject.storage.getScheduler('a'))?.active).toBe(true)
    })
  })
}
