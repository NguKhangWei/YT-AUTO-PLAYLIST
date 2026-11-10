// Decides which uploads count as regular videos (no Shorts, livestreams or premieres).
import type { SkipReason, VideoDetails } from './youtube/types'

const SHORTS_MAX_SECONDS = 180 // Shorts can be up to 3 minutes

export interface FilterResult {
  regular: VideoDetails[]
  skipped: { video: VideoDetails; reason: SkipReason }[]
}

/** Seconds in an ISO 8601 duration as YouTube returns it ("PT1H2M3S", "P0D"); 0 if unreadable. */
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

/** Splits videos into regular ones and skipped ones; `isShort` is only asked about short videos. */
export async function filterRegularVideos(
  videos: VideoDetails[],
  isShort: (videoId: string) => Promise<boolean>,
): Promise<FilterResult> {
  const result: FilterResult = { regular: [], skipped: [] }
  for (const video of videos) {
    let reason: SkipReason | undefined
    if (video.liveBroadcastContent === 'live') reason = 'live'
    else if (video.liveBroadcastContent === 'upcoming') reason = 'upcoming'
    else if (video.hasLiveStreamingDetails) reason = 'livestream'
    else if (video.durationSeconds <= SHORTS_MAX_SECONDS && (await isShort(video.id))) {
      reason = 'short'
    }
    if (reason) result.skipped.push({ video, reason })
    else result.regular.push(video)
  }
  return result
}
