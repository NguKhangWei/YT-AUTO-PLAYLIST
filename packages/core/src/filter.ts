import type { VideoDetails } from './youtube/types'

/** Videos at or under this length are checked against `/shorts/` (Shorts can be up to 3 minutes). */
export const SHORTS_MAX_SECONDS = 180

export type SkipReason = 'live' | 'upcoming' | 'livestream' | 'short'

export interface FilterResult {
  regular: VideoDetails[]
  skipped: { video: VideoDetails; reason: SkipReason }[]
}

/**
 * Parse an ISO 8601 duration as YouTube returns it ("PT1H2M3S", "P1DT2H",
 * "P0D") into seconds. Unparseable input gives 0.
 */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso)
  if (!m) return 0
  const [, w, d, h, min, s] = m
  return (
    Number(w ?? 0) * 604_800 +
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3_600 +
    Number(min ?? 0) * 60 +
    Math.floor(Number(s ?? 0))
  )
}

/**
 * Classify a video without network access. Returns a skip reason, `'maybeShort'`
 * when only the `/shorts/` probe can tell, or `'regular'`.
 */
export function classifyVideo(v: VideoDetails): SkipReason | 'maybeShort' | 'regular' {
  if (v.liveBroadcastContent === 'live') return 'live'
  if (v.liveBroadcastContent === 'upcoming') return 'upcoming'
  // Finished livestreams and premieres both carry liveStreamingDetails.
  if (v.hasLiveStreamingDetails) return 'livestream'
  if (v.durationSeconds <= SHORTS_MAX_SECONDS) return 'maybeShort'
  return 'regular'
}

/**
 * Keep regular uploads only: drops live, upcoming, finished livestreams,
 * premieres and Shorts. `isShort` is only called for videos of 3 minutes or less.
 */
export async function filterRegularVideos(
  videos: VideoDetails[],
  isShort: (videoId: string) => Promise<boolean>,
): Promise<FilterResult> {
  const result: FilterResult = { regular: [], skipped: [] }
  for (const video of videos) {
    let kind = classifyVideo(video)
    if (kind === 'maybeShort') kind = (await isShort(video.id)) ? 'short' : 'regular'
    if (kind === 'regular') result.regular.push(video)
    else result.skipped.push({ video, reason: kind })
  }
  return result
}
