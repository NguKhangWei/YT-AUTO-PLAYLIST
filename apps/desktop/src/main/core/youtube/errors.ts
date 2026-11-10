// Typed errors for YouTube API and Google sign-in failures.

export type YouTubeErrorKind =
  | 'quotaExceeded' // resets at midnight Pacific Time
  | 'rateLimited'
  | 'playlistNotFound'
  | 'playlistFull' // 5,000-video limit
  | 'videoNotFound'
  | 'unauthorized' // sign-in revoked or expired
  | 'forbidden'
  | 'notFound'
  | 'network'
  | 'unknown'

export class YouTubeApiError extends Error {
  override readonly name = 'YouTubeApiError'

  constructor(
    readonly kind: YouTubeErrorKind,
    message: string,
  ) {
    super(message)
  }
}

const REASON_KINDS: Record<string, YouTubeErrorKind> = {
  quotaExceeded: 'quotaExceeded',
  dailyLimitExceeded: 'quotaExceeded',
  rateLimitExceeded: 'rateLimited',
  userRateLimitExceeded: 'rateLimited',
  playlistNotFound: 'playlistNotFound',
  playlistContainsMaximumNumberOfVideos: 'playlistFull',
  videoNotFound: 'videoNotFound',
  authError: 'unauthorized',
}

const STATUS_KINDS: Record<number, YouTubeErrorKind> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  429: 'rateLimited',
}

/** Turns a failed API response into a YouTubeApiError, using Google's error reason when known. */
export function toYouTubeError(status: number, body: unknown): YouTubeApiError {
  const err = (body as { error?: { message?: string; errors?: { reason?: string }[] } } | null)
    ?.error
  const reason = err?.errors?.[0]?.reason
  const kind = (reason && REASON_KINDS[reason]) || STATUS_KINDS[status] || 'unknown'
  return new YouTubeApiError(kind, err?.message ?? `YouTube API request failed with HTTP ${status}`)
}
