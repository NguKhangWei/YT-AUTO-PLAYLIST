import { describe, expect, it } from 'vitest'
import { createMemoryStorage, OVERLAP_MS, runScan, type ScanDeps } from '../src'
import { contractChannel, contractScheduler } from '../src/testing'
import { fakeYouTube, type FakeVideo } from './helpers/fakeYouTube'

const SINCE = '2026-11-01T00:00:00Z'
const PL = 'PL-s1'

/** Two channels (UC1 → UU1, UC2 → UU2) tracked since Nov 1 by scheduler "s1". */
function setup(videos: FakeVideo[], opts: { playlist?: string[]; now?: string } = {}) {
  const yt = fakeYouTube(videos, { [PL]: opts.playlist ?? [] })
  const storage = createMemoryStorage()
  storage.putScheduler(contractScheduler('s1', { playlistId: PL }))
  storage.trackChannel('s1', contractChannel('UC1', new Date(SINCE)))
  storage.trackChannel('s1', contractChannel('UC2', new Date(SINCE)))
  let now = new Date(opts.now ?? '2026-11-10T01:00:00Z')
  const deps: ScanDeps = { storage, client: yt.client, isShort: yt.isShort, now: () => now }
  return {
    yt,
    storage,
    deps,
    scan: () => runScan('s1', deps),
    setNow: (iso: string) => (now = new Date(iso)),
  }
}

const v = (id: string, publishedAt: string, over: Partial<FakeVideo> = {}): FakeVideo => ({
  id,
  channelUploads: 'UU1',
  publishedAt,
  ...over,
})

describe('runScan: first scan', () => {
  it('adds new regular uploads from all channels, oldest first, and marks success', async () => {
    const t = setup([
      v('old', '2026-10-31T23:59:59Z'), // before the channel was added
      v('a3', '2026-11-08T00:00:00Z'),
      v('a1', '2026-11-02T00:00:00Z'),
      v('b2', '2026-11-05T00:00:00Z', { channelUploads: 'UU2' }),
      v('edge', SINCE), // exactly at sinceAt counts
    ])
    const r = await t.scan()

    expect(r.status).toBe('ok')
    expect(r.added.map((x) => x.id)).toEqual(['edge', 'a1', 'b2', 'a3'])
    expect(t.yt.playlist(PL)).toEqual(['edge', 'a1', 'b2', 'a3'])
    expect(r.error).toBeUndefined()
    expect((await t.storage.getScheduler('s1'))?.lastSuccessAt).toEqual(r.startedAt)
    expect(await t.storage.listAddedVideoIds('s1')).toEqual(new Set(['edge', 'a1', 'b2', 'a3']))
  })

  it('skips Shorts, livestreams, premieres and upcoming streams, and remembers them', async () => {
    const t = setup([
      v('reg', '2026-11-02T00:00:00Z'),
      v('short', '2026-11-03T00:00:00Z', { short: true }),
      v('tiny-regular', '2026-11-03T01:00:00Z', { durationSeconds: 19 }),
      v('vod', '2026-11-04T00:00:00Z', { stream: true }),
      v('soon', '2026-11-05T00:00:00Z', { live: 'upcoming' }),
    ])
    const r = await t.scan()
    expect(r.added.map((x) => x.id)).toEqual(['reg', 'tiny-regular'])
    expect(Object.fromEntries(r.skipped.map((s) => [s.videoId, s.reason]))).toEqual({
      short: 'short',
      vod: 'livestream',
      soon: 'upcoming',
    })

    // Next scan doesn't probe or re-check the skipped ones.
    t.yt.calls.probes.length = 0
    t.setNow('2026-11-11T01:00:00Z')
    const again = await t.scan()
    expect(again.skipped).toEqual([])
    expect(t.yt.calls.probes).toEqual([])
  })

  it('succeeds with nothing to do and makes no playlist calls', async () => {
    const t = setup([v('old', '2026-10-01T00:00:00Z')])
    const r = await t.scan()
    expect(r).toMatchObject({ status: 'ok', added: [], skipped: [] })
    expect(t.yt.calls.inserts).toBe(0)
    expect((await t.storage.getScheduler('s1'))?.lastSuccessAt).toEqual(r.startedAt)
  })
})

describe('runScan: no duplicates', () => {
  it('adds nothing on a rerun, even inside the 24 h overlap window', async () => {
    const t = setup([v('a', '2026-11-09T20:00:00Z'), v('b', '2026-11-09T23:00:00Z')])
    await t.scan()
    t.setNow('2026-11-10T02:00:00Z') // 1 h later: both videos are inside the overlap
    const r = await t.scan()
    expect(r.added).toEqual([])
    expect(t.yt.playlist(PL)).toEqual(['a', 'b'])
    expect(t.yt.calls.inserts).toBe(2)
  })

  it('skips videos already in the playlist (added by hand) and remembers them', async () => {
    const t = setup([v('a', '2026-11-02T00:00:00Z'), v('b', '2026-11-03T00:00:00Z')], {
      playlist: ['b'],
    })
    const r = await t.scan()
    expect(r.added.map((x) => x.id)).toEqual(['a'])
    expect(r.skipped).toEqual([{ videoId: 'b', title: 'Title b', reason: 'inPlaylist' }])
    expect(t.yt.playlist(PL)).toEqual(['b', 'a'])
    expect(await t.storage.listAddedVideoIds('s1')).toEqual(new Set(['a', 'b']))
  })

  it('does not re-add a video you removed from the playlist', async () => {
    const t = setup([v('a', '2026-11-09T20:00:00Z')])
    await t.scan()
    t.yt.playlist(PL)!.length = 0 // user removes it in YouTube
    t.setNow('2026-11-10T02:00:00Z')
    expect((await t.scan()).added).toEqual([])
    expect(t.yt.playlist(PL)).toEqual([])
  })

  it('adds a video uploaded to two tracked channels (collab) once', async () => {
    const t = setup([v('collab', '2026-11-02T00:00:00Z')])
    // Same video id also listed under channel 2's uploads.
    const original = t.yt.client.listUploadsSince
    t.deps.client = {
      ...t.yt.client,
      listUploadsSince: async (id, since) =>
        id === 'UU2'
          ? [{ videoId: 'collab', publishedAt: new Date('2026-11-02T00:00:00Z') }]
          : original(id, since),
    }
    const r = await t.scan()
    expect(r.added.map((x) => x.id)).toEqual(['collab'])
    expect(t.yt.calls.inserts).toBe(1)
  })
})

describe('runScan: cursor', () => {
  it("reads uploads from each channel's sinceAt on the first scan", async () => {
    const t = setup([])
    await t.scan()
    expect(t.yt.calls.listUploadsSince.map((c) => c.since)).toEqual([
      new Date(SINCE),
      new Date(SINCE),
    ])
  })

  it('reads from lastSuccessAt − 24 h afterwards', async () => {
    const t = setup([])
    const first = await t.scan()
    t.yt.calls.listUploadsSince.length = 0
    t.setNow('2026-11-13T01:00:00Z')
    await t.scan()
    const expected = new Date(first.startedAt.getTime() - OVERLAP_MS)
    expect(t.yt.calls.listUploadsSince.map((c) => c.since)).toEqual([expected, expected])
  })

  it('ignores older uploads of a channel added to the scheduler later', async () => {
    const t = setup([
      v('c-old', '2026-11-03T00:00:00Z', { channelUploads: 'UU3' }),
      v('c-new', '2026-11-07T00:00:00Z', { channelUploads: 'UU3' }),
    ])
    t.storage.trackChannel('s1', contractChannel('UC3', new Date('2026-11-06T00:00:00Z')))
    const r = await t.scan()
    expect(r.added.map((x) => x.id)).toEqual(['c-new'])
  })
})

describe('runScan: quota and partial scans', () => {
  const three = [
    v('a', '2026-11-02T00:00:00Z'),
    v('b', '2026-11-03T00:00:00Z'),
    v('c', '2026-11-04T00:00:00Z'),
  ]

  it('stops on quotaExceeded, keeps what was added, and does not advance the cursor', async () => {
    const t = setup(three)
    t.yt.queueInsertResults(undefined, undefined, 'quotaExceeded')
    const r = await t.scan()
    expect(r.status).toBe('partial')
    expect(r.error?.kind).toBe('quotaExceeded')
    expect(r.added.map((x) => x.id)).toEqual(['a', 'b'])
    expect((await t.storage.getScheduler('s1'))?.lastSuccessAt).toBeUndefined()
  })

  it('finishes the rest on the next scan without duplicates', async () => {
    const t = setup(three)
    t.yt.queueInsertResults(undefined, 'quotaExceeded')
    await t.scan()
    t.setNow('2026-11-11T01:00:00Z')
    const r = await t.scan()
    expect(r.status).toBe('ok')
    expect(r.added.map((x) => x.id)).toEqual(['b', 'c'])
    expect(t.yt.playlist(PL)).toEqual(['a', 'b', 'c'])
  })

  it('is an error (not partial) when nothing could be added', async () => {
    const t = setup(three)
    t.yt.queueInsertResults('quotaExceeded')
    const r = await t.scan()
    expect(r).toMatchObject({ status: 'error', added: [], error: { kind: 'quotaExceeded' } })
  })

  it('warns when the local quota estimate is too low, but still tries', async () => {
    const t = setup(three)
    t.deps.quotaRemaining = () => 120 // enough for 2 inserts (50 each), not 3
    const r = await t.scan()
    expect(r.quotaWarning).toBe(true)
    expect(r.added).toHaveLength(3)
  })

  it('does not warn when the estimate is enough', async () => {
    const t = setup(three)
    t.deps.quotaRemaining = () => 150
    expect((await t.scan()).quotaWarning).toBe(false)
  })
})

describe('runScan: errors', () => {
  it('turns the scheduler off when its playlist was deleted', async () => {
    const t = setup([v('a', '2026-11-02T00:00:00Z')])
    t.yt.deletePlaylist(PL)
    const r = await t.scan()
    expect(r).toMatchObject({
      status: 'error',
      deactivated: true,
      error: { kind: 'playlistNotFound' },
    })
    expect((await t.storage.getScheduler('s1'))?.active).toBe(false)
    expect((await t.storage.getScheduler('s1'))?.lastSuccessAt).toBeUndefined()
  })

  it('turns it off even if the playlist disappears mid-scan', async () => {
    const t = setup([v('a', '2026-11-02T00:00:00Z'), v('b', '2026-11-03T00:00:00Z')])
    t.yt.queueInsertResults(undefined, 'playlistNotFound')
    const r = await t.scan()
    expect(r).toMatchObject({ status: 'error', deactivated: true })
    expect(r.added.map((x) => x.id)).toEqual(['a'])
  })

  it('reports a full playlist without turning the scheduler off', async () => {
    const t = setup([v('a', '2026-11-02T00:00:00Z')])
    t.yt.queueInsertResults('playlistFull')
    const r = await t.scan()
    expect(r).toMatchObject({
      status: 'error',
      deactivated: false,
      error: { kind: 'playlistFull' },
    })
    expect((await t.storage.getScheduler('s1'))?.active).toBe(true)
  })

  it.each(['unauthorized', 'network', 'rateLimited'] as const)(
    'stops with %s before changing anything',
    async (kind) => {
      const t = setup([v('a', '2026-11-02T00:00:00Z')])
      t.yt.failOn.listUploadsSince = kind
      const r = await t.scan()
      expect(r).toMatchObject({ status: 'error', error: { kind }, added: [], deactivated: false })
      expect(await t.storage.listAddedVideoIds('s1')).toEqual(new Set())
      expect((await t.storage.getScheduler('s1'))?.lastSuccessAt).toBeUndefined()
    },
  )

  it('keeps scanning other channels when one channel is gone', async () => {
    const t = setup([
      v('a', '2026-11-02T00:00:00Z'),
      v('b', '2026-11-03T00:00:00Z', { channelUploads: 'UU2' }),
    ])
    t.yt.removeUploads('UU1')
    const r = await t.scan()
    expect(r.status).toBe('ok')
    expect(r.unavailableChannels.map((c) => c.id)).toEqual(['UC1'])
    expect(r.added.map((x) => x.id)).toEqual(['b'])
  })

  it('skips a video deleted before it could be added and continues', async () => {
    const t = setup([v('a', '2026-11-02T00:00:00Z'), v('b', '2026-11-03T00:00:00Z')])
    t.yt.queueInsertResults('videoNotFound')
    const r = await t.scan()
    expect(r.status).toBe('ok')
    expect(r.added.map((x) => x.id)).toEqual(['b'])
    expect(r.skipped).toEqual([{ videoId: 'a', title: 'Title a', reason: 'unavailable' }])
  })

  it('skips private/hidden videos without remembering them, so they are retried', async () => {
    const t = setup([v('hidden', '2026-11-02T00:00:00Z', { hidden: true })])
    const r = await t.scan()
    expect(r.skipped).toEqual([{ videoId: 'hidden', reason: 'unavailable' }])
    expect(await t.storage.listAddedVideoIds('s1')).toEqual(new Set())
  })

  it('reports an unknown scheduler', async () => {
    const t = setup([])
    const r = await runScan('missing', t.deps)
    expect(r).toMatchObject({ status: 'error', error: { kind: 'schedulerNotFound' } })
  })

  it('rethrows non-API errors (bugs) instead of reporting them as scan errors', async () => {
    const t = setup([v('s', '2026-11-02T00:00:00Z', { short: true })])
    t.deps.isShort = async () => {
      throw new TypeError('boom')
    }
    await expect(t.scan()).rejects.toThrow('boom')
  })
})

describe('runScan: several schedulers', () => {
  it('lets the same channel feed two schedulers, each into its own playlist', async () => {
    const yt = fakeYouTube([v('a', '2026-11-02T00:00:00Z')], { 'PL-s1': [], 'PL-s2': [] })
    const storage = createMemoryStorage()
    for (const id of ['s1', 's2']) {
      storage.putScheduler(contractScheduler(id, { playlistId: `PL-${id}` }))
      storage.trackChannel(id, contractChannel('UC1', new Date(SINCE)))
    }
    const deps: ScanDeps = {
      storage,
      client: yt.client,
      isShort: yt.isShort,
      now: () => new Date('2026-11-10T01:00:00Z'),
    }
    await runScan('s1', deps)
    await runScan('s2', deps)
    expect(yt.playlist('PL-s1')).toEqual(['a'])
    expect(yt.playlist('PL-s2')).toEqual(['a'])
    // Each scheduler keeps its own history.
    expect(await storage.listAddedVideoIds('s1')).toEqual(new Set(['a']))
    expect(await storage.listAddedVideoIds('s2')).toEqual(new Set(['a']))
  })
})
