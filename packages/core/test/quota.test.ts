import { describe, expect, it } from 'vitest'
import { QUOTA_COSTS, quotaDay, toYouTubeError } from '../src'

describe('quotaDay', () => {
  it('rolls over at midnight Pacific Time, not UTC or Malaysia Time', () => {
    // Nov 10 2026: PST (UTC-8), midnight PT = 08:00 UTC = 16:00 Malaysia Time.
    expect(quotaDay(new Date('2026-11-10T07:59:59Z'))).toBe('2026-11-09')
    expect(quotaDay(new Date('2026-11-10T08:00:00Z'))).toBe('2026-11-10')
  })

  it('follows Pacific daylight time in summer', () => {
    // July: PDT (UTC-7), midnight PT = 07:00 UTC.
    expect(quotaDay(new Date('2026-07-01T06:59:59Z'))).toBe('2026-06-30')
    expect(quotaDay(new Date('2026-07-01T07:00:00Z'))).toBe('2026-07-01')
  })
})

describe('QUOTA_COSTS', () => {
  it('matches the YouTube Data API quota table', () => {
    expect(QUOTA_COSTS['search.list']).toBe(100)
    expect(QUOTA_COSTS['playlistItems.insert']).toBe(50)
    expect(QUOTA_COSTS['videos.list']).toBe(1)
  })
})

describe('toYouTubeError', () => {
  it('falls back to the HTTP status when there is no known reason', () => {
    expect(toYouTubeError(401, null).kind).toBe('unauthorized')
    expect(toYouTubeError(403, {}).kind).toBe('forbidden')
    expect(toYouTubeError(404, 'not json').kind).toBe('notFound')
    expect(toYouTubeError(429, null).kind).toBe('rateLimited')
    expect(toYouTubeError(502, null)).toMatchObject({
      kind: 'unknown',
      message: 'YouTube API request failed with HTTP 502',
    })
  })
})
