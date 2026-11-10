import {
  YouTubeApiError,
  type ScanDeps,
  type UploadItem,
  type VideoDetails,
  type YouTubeErrorKind,
} from '@auto-yt/core'
import { contractChannel, contractScheduler } from '@auto-yt/core/testing'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'
import { createRunner } from './runner'

const SINCE = new Date('2026-11-01T00:00:00Z')

/** Each tracked channel UCn uploads the videos listed for it; playlists start empty. */
function fakeYouTube(uploads: Record<string, { id: string; at: string; short?: boolean }[]>) {
  const playlists = new Map<string, string[]>()
  const all = Object.values(uploads).flat()
  /** Results for the next inserts: an error kind fails that insert, undefined lets it through. */
  const failInsert: (YouTubeErrorKind | undefined)[] = []
  const client: ScanDeps['client'] = {
    async listUploadsSince(uploadsId, since) {
      return (uploads[uploadsId] ?? [])
        .filter((v) => new Date(v.at) >= since)
        .map((v): UploadItem => ({ videoId: v.id, publishedAt: new Date(v.at) }))
    },
    async getVideos(ids) {
      return ids.map((id): VideoDetails => ({
        id,
        title: `Title ${id}`,
        channelId: 'UC',
        publishedAt: new Date(all.find((v) => v.id === id)!.at),
        durationSeconds: all.find((v) => v.id === id)?.short ? 30 : 600,
        liveBroadcastContent: 'none',
        hasLiveStreamingDetails: false,
      }))
    },
    async listPlaylistVideoIds(id) {
      if (id === 'PL-deleted') throw new YouTubeApiError('playlistNotFound', 'gone')
      return new Set(playlists.get(id))
    },
    async insertPlaylistItem(playlistId, videoId) {
      const kind = failInsert.shift()
      if (kind) throw new YouTubeApiError(kind, `fake ${kind}`)
      playlists.set(playlistId, [...(playlists.get(playlistId) ?? []), videoId])
    },
  }
  const isShort = async (id: string) => !!all.find((v) => v.id === id)?.short
  return { client, isShort, playlists, failInsert }
}

function setup(
  uploads: Record<string, { id: string; at: string; short?: boolean }[]> = {
    UU1: [
      { id: 'a', at: '2026-11-02T00:00:00Z' },
      { id: 'b', at: '2026-11-03T00:00:00Z' },
    ],
  },
) {
  const storage = createSqliteStorage(openDatabase(':memory:'))
  const yt = fakeYouTube(uploads)
  const notify = vi.fn()
  const onChange = vi.fn()
  const log = vi.fn()
  const runner = createRunner({
    storage,
    youtube: yt.client,
    isShort: yt.isShort,
    quotaRemaining: () => 10_000,
    now: () => new Date('2026-11-10T02:00:00Z'),
    notify,
    onChange,
    log,
  })
  const addScheduler = (id: string, playlistId = `PL-${id}`) => {
    storage.insertScheduler(contractScheduler(id, { playlistId, playlistTitle: `List ${id}` }))
    const t = contractChannel('UC1', SINCE)
    storage.trackChannel(id, t.channel, t.sinceAt)
  }
  return { storage, yt, notify, onChange, log, runner, addScheduler }
}

describe('runner', () => {
  it('scans, records the run in history and notifies what was added', async () => {
    const t = setup()
    t.addScheduler('s1')
    const run = await t.runner.run('s1')

    expect(run).toMatchObject({
      schedulerId: 's1',
      schedulerName: 'Scheduler s1',
      trigger: 'manual',
      status: 'ok',
      addedCount: 2,
      startedAt: '2026-11-10T02:00:00.000Z',
    })
    expect(run.details?.added.map((v) => v.title)).toEqual(['Title a', 'Title b'])
    expect(t.yt.playlists.get('PL-s1')).toEqual(['a', 'b'])
    expect(t.storage.listRuns()).toEqual([run])
    expect(t.onChange).toHaveBeenCalledTimes(2) // started, finished
    expect(t.notify).toHaveBeenCalledWith({
      title: 'Added 2 videos to List s1',
      body: '• Title a\n• Title b',
    })
  })

  it('shows the run as "running" while it is in progress', async () => {
    const t = setup()
    t.addScheduler('s1')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const original = t.yt.client.listUploadsSince
    t.yt.client.listUploadsSince = async (...args) => {
      await gate
      return original(...args)
    }
    const p = t.runner.run('s1')
    await vi.waitFor(() => expect(t.storage.listRuns()[0]?.status).toBe('running'))
    expect(t.runner.isQueued('s1')).toBe(true)
    release()
    await p
    expect(t.storage.listRuns()[0]?.status).toBe('ok')
    expect(t.runner.isQueued('s1')).toBe(false)
  })

  it('does not notify when there was nothing new', async () => {
    const t = setup({ UU1: [] })
    t.addScheduler('s1')
    expect((await t.runner.run('s1')).status).toBe('ok')
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('returns the same run when asked twice while it is queued', async () => {
    const t = setup()
    t.addScheduler('s1')
    const [a, b] = await Promise.all([t.runner.run('s1'), t.runner.run('s1')])
    expect(a).toEqual(b)
    expect(t.storage.listRuns()).toHaveLength(1)
  })

  it('runs scans one at a time, in order', async () => {
    const t = setup()
    t.addScheduler('s1')
    t.addScheduler('s2')
    const order: string[] = []
    const original = t.yt.client.insertPlaylistItem
    t.yt.client.insertPlaylistItem = async (pl, v) => {
      order.push(`${pl}:start`)
      await new Promise((r) => setTimeout(r, 5))
      await original(pl, v)
      order.push(`${pl}:end`)
    }
    await Promise.all([t.runner.run('s1'), t.runner.run('s2')])
    expect(order).toEqual([
      'PL-s1:start',
      'PL-s1:end',
      'PL-s1:start',
      'PL-s1:end',
      'PL-s2:start',
      'PL-s2:end',
      'PL-s2:start',
      'PL-s2:end',
    ])
  })

  it('records a crash as an internal error and keeps the queue going', async () => {
    const t = setup({ UU1: [{ id: 'short', at: '2026-11-02T00:00:00Z', short: true }] })
    t.addScheduler('s1')
    t.addScheduler('s2')
    const broken = createRunner({
      storage: t.storage,
      youtube: t.yt.client,
      isShort: async () => {
        throw new TypeError('boom')
      },
      quotaRemaining: () => 10_000,
      now: () => new Date('2026-11-10T02:00:00Z'),
      notify: t.notify,
      onChange: t.onChange,
      log: t.log,
    })
    const first = await broken.run('s1')
    expect(first).toMatchObject({ status: 'error', error: { kind: 'internal', message: 'boom' } })
    expect(t.log).toHaveBeenCalled()
    expect((await broken.run('s2')).status).toBe('error') // still runs
  })

  it('tells the user to sign in again when access was revoked', async () => {
    const t = setup()
    t.addScheduler('s1')
    t.yt.client.listUploadsSince = async () => {
      throw new YouTubeApiError('unauthorized', 'revoked')
    }
    expect((await t.runner.run('s1')).error?.kind).toBe('unauthorized')
    expect(t.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'auto-yt: please sign in again' }),
    )
  })

  it('turns off a scheduler whose playlist was deleted, and says so', async () => {
    const t = setup()
    t.addScheduler('s1', 'PL-deleted')
    const run = await t.runner.run('s1')
    expect(run.details?.deactivated).toBe(true)
    expect((await t.storage.getScheduler('s1'))?.active).toBe(false)
    expect(t.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Scheduler s1 was turned off' }),
    )
  })

  it('records a partial scan when quota runs out mid-way', async () => {
    const t = setup()
    t.addScheduler('s1')
    t.yt.failInsert.push(undefined, 'quotaExceeded') // first insert passes, second hits quota
    const run = await t.runner.run('s1')
    expect(run).toMatchObject({
      status: 'partial',
      addedCount: 1,
      error: { kind: 'quotaExceeded' },
    })
    expect(t.notify.mock.calls[0]![0].body).toMatch(/Added 1 video, then stopped/)
  })

  it('rejects an unknown scheduler', async () => {
    const t = setup()
    await expect(t.runner.run('nope')).rejects.toMatchObject({ kind: 'validation' })
    expect(t.storage.listRuns()).toEqual([])
  })
})
