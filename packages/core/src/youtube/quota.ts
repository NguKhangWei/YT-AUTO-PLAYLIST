import { DateTime } from 'luxon'

/** Default daily quota of a Google Cloud project for the YouTube Data API. */
export const DAILY_QUOTA = 10_000

/** Units each endpoint costs (YouTube Data API v3 quota table). */
export const QUOTA_COSTS = {
  'search.list': 100,
  'channels.list': 1,
  'playlists.list': 1,
  'playlistItems.list': 1,
  'videos.list': 1,
  'playlistItems.insert': 50,
} as const

export type ApiMethod = keyof typeof QUOTA_COSTS

/**
 * The quota day `at` falls in, as "yyyy-MM-dd". YouTube resets quota at
 * midnight Pacific Time, so this is the date in America/Los_Angeles.
 */
export function quotaDay(at: Date): string {
  return DateTime.fromJSDate(at, { zone: 'America/Los_Angeles' }).toFormat('yyyy-MM-dd')
}

/** When the quota day containing `at` ends: the next midnight in Pacific Time. */
export function nextQuotaReset(at: Date): Date {
  return DateTime.fromJSDate(at, { zone: 'America/Los_Angeles' })
    .startOf('day')
    .plus({ days: 1 })
    .toJSDate()
}
