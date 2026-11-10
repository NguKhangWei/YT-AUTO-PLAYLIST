export type YouTubeErrorKind =
  /** Daily API quota used up; resets at midnight Pacific Time. */
  | 'quotaExceeded'
  /** Too many requests in a short time. */
  | 'rateLimited'
  /** The target playlist was deleted or isn't the user's. */
  | 'playlistNotFound'
  /** The playlist reached YouTube's 5,000-video limit. */
  | 'playlistFull'
  /** The video was deleted or made private. */
  | 'videoNotFound'
  /** The signed-in Google account has no YouTube channel (so no playlists). */
  | 'noChannel'
  /** Access token rejected, or the refresh token was revoked/expired (re-login needed). */
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'network'
  | 'unknown'

export class YouTubeApiError extends Error {
  override readonly name = 'YouTubeApiError'

  constructor(
    readonly kind: YouTubeErrorKind,
    message: string,
    readonly status?: number,
    /** Google's `errors[0].reason`, e.g. "quotaExceeded". */
    readonly reason?: string,
  ) {
    super(message)
  }
}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] }
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

/** Map a non-2xx YouTube Data API response to a typed error. */
export function toYouTubeError(status: number, body: unknown): YouTubeApiError {
  const err = (body as GoogleErrorBody | null)?.error
  const reason = err?.errors?.[0]?.reason
  const message = err?.message ?? `YouTube API request failed with HTTP ${status}`
  const known = reason ? REASON_KINDS[reason] : undefined
  const kind =
    known ??
    (status === 401
      ? 'unauthorized'
      : status === 429
        ? 'rateLimited'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'notFound'
            : 'unknown')
  return new YouTubeApiError(kind, message, status, reason)
}
