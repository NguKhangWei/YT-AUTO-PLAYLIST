import { describe, expect, it } from 'vitest'
import type { RunView } from '../shared/api'
import { notificationFor } from './notifications'

const base = (over: Partial<RunView> = {}): RunView => ({
  id: 'r',
  schedulerId: 's',
  schedulerName: 'Gaming',
  trigger: 'scheduled',
  status: 'ok',
  startedAt: '2026-11-10T01:00:00.000Z',
  addedCount: 0,
  details: {
    added: [],
    skipped: [],
    unavailableChannels: [],
    quotaWarning: false,
    deactivated: false,
  },
  ...over,
})

const added = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `v${i}`, title: `Video ${i + 1}`, publishedAt: '' }))

describe('notificationFor', () => {
  it('lists up to three added titles', () => {
    const run = base({ addedCount: 5, details: { ...base().details!, added: added(5) } })
    expect(notificationFor(run, 'Games')).toEqual({
      title: 'Added 5 videos to Games',
      body: '• Video 1\n• Video 2\n• Video 3\n…and 2 more',
    })
    expect(
      notificationFor(
        base({ addedCount: 1, details: { ...base().details!, added: added(1) } }),
        'Games',
      )?.title,
    ).toBe('Added 1 video to Games')
  })

  it('stays quiet when nothing was new', () => {
    expect(notificationFor(base(), 'Games')).toBeNull()
  })

  it('mentions channels that could not be read', () => {
    const run = base({
      details: { ...base().details!, unavailableChannels: [{ id: 'UC1', title: 'Old Channel' }] },
    })
    expect(notificationFor(run, 'Games')?.body).toContain(
      "1 channel couldn't be read (deleted?): Old Channel",
    )
  })

  it.each([
    ['unauthorized', 'auto-yt: please sign in again'],
    ['quotaExceeded', 'Gaming: YouTube daily quota used up'],
    ['playlistFull', 'Gaming: playlist is full'],
    ['network', 'Gaming: scan failed'],
  ])('explains a %s error', (kind, title) => {
    expect(
      notificationFor(base({ status: 'error', error: { kind, message: 'msg' } }), 'Games')?.title,
    ).toBe(title)
  })

  it('explains a scheduler turned off because its playlist is gone', () => {
    const run = base({
      status: 'error',
      error: { kind: 'playlistNotFound', message: 'x' },
      details: { ...base().details!, deactivated: true },
    })
    expect(notificationFor(run, 'Games')).toEqual({
      title: 'Gaming was turned off',
      body: 'Its playlist "Games" no longer exists. Pick another playlist and turn the scheduler back on.',
    })
  })

  it('says what a partial scan managed', () => {
    const run = base({
      status: 'partial',
      addedCount: 3,
      error: { kind: 'rateLimited', message: 'Slow down' },
    })
    expect(notificationFor(run, 'Games')).toEqual({
      title: 'Gaming: scan stopped early',
      body: 'Added 3 videos, then stopped. The rest will be added next scan.\nSlow down',
    })
  })
})
