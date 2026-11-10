import { describe, expect, it, vi } from 'vitest'
import { classifyVideo, filterRegularVideos, parseIsoDuration, type VideoDetails } from '../src'

const video = (over: Partial<VideoDetails> = {}): VideoDetails => ({
  id: 'v',
  title: 'A video',
  channelId: 'UCa',
  publishedAt: new Date('2026-11-05T00:00:00Z'),
  durationSeconds: 600,
  liveBroadcastContent: 'none',
  hasLiveStreamingDetails: false,
  ...over,
})

describe('parseIsoDuration', () => {
  it.each([
    ['PT12M3S', 723],
    ['PT1H', 3600],
    ['PT1H2M3S', 3723],
    ['PT59S', 59],
    ['PT3M', 180],
    ['P1DT2H', 93_600],
    ['P1W', 604_800],
    ['PT1.5S', 1],
    ['P0D', 0],
    ['PT0S', 0],
    ['garbage', 0],
    ['', 0],
  ])('%s → %i seconds', (iso, seconds) => {
    expect(parseIsoDuration(iso)).toBe(seconds)
  })
})

describe('classifyVideo', () => {
  it('flags live and upcoming broadcasts', () => {
    expect(
      classifyVideo(video({ liveBroadcastContent: 'live', hasLiveStreamingDetails: true })),
    ).toBe('live')
    expect(
      classifyVideo(video({ liveBroadcastContent: 'upcoming', hasLiveStreamingDetails: true })),
    ).toBe('upcoming')
  })

  it('flags finished livestreams and premieres by their liveStreamingDetails', () => {
    expect(classifyVideo(video({ hasLiveStreamingDetails: true, durationSeconds: 7200 }))).toBe(
      'livestream',
    )
  })

  it('needs the Shorts probe only at 3 minutes or less', () => {
    expect(classifyVideo(video({ durationSeconds: 180 }))).toBe('maybeShort')
    expect(classifyVideo(video({ durationSeconds: 45 }))).toBe('maybeShort')
    expect(classifyVideo(video({ durationSeconds: 181 }))).toBe('regular')
  })
})

describe('filterRegularVideos', () => {
  it('keeps only regular videos and reports why others were skipped', async () => {
    const isShort = vi.fn(async (id: string) => id === 'short')
    const result = await filterRegularVideos(
      [
        video({ id: 'long' }),
        video({ id: 'short', durationSeconds: 30 }),
        video({ id: 'brief-regular', durationSeconds: 90 }),
        video({ id: 'vod', hasLiveStreamingDetails: true }),
        video({
          id: 'soon',
          liveBroadcastContent: 'upcoming',
          hasLiveStreamingDetails: true,
          durationSeconds: 0,
        }),
        video({ id: 'now', liveBroadcastContent: 'live', hasLiveStreamingDetails: true }),
      ],
      isShort,
    )
    expect(result.regular.map((v) => v.id)).toEqual(['long', 'brief-regular'])
    expect(result.skipped.map((s) => [s.video.id, s.reason])).toEqual([
      ['short', 'short'],
      ['vod', 'livestream'],
      ['soon', 'upcoming'],
      ['now', 'live'],
    ])
    // The free /shorts/ probe only runs for ≤3-minute non-live videos.
    expect(isShort.mock.calls.map(([id]) => id)).toEqual(['short', 'brief-regular'])
  })
})
