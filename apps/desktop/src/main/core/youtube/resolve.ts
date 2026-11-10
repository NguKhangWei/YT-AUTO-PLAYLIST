// Recognises channel ids, @handles and channel URLs typed into the search box.

export type ChannelLookup = { ids: string[] } | { forHandle: string } | { forUsername: string }

const CHANNEL_ID = /^UC[\w-]{22}$/
const HANDLE = /^@[\p{L}\p{N}_.-]{3,30}$/u
const YOUTUBE_HOST = /^(?:www\.|m\.|music\.)?youtube\.com$/i

/**
 * The direct lookup for a channel id, @handle or YouTube channel URL (scheme
 * optional, any trailing path), or null when the input is plain search text.
 * Legacy `/c/name` URLs are tried as `@name`.
 */
export function channelLookup(raw: string): ChannelLookup | null {
  const input = raw.trim()
  if (CHANNEL_ID.test(input)) return { ids: [input] }
  if (HANDLE.test(input)) return { forHandle: input }
  if (!/^(https?:\/\/)?([\w-]+\.)*youtube\.com\//i.test(input)) return null

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
  if (!YOUTUBE_HOST.test(url.hostname)) return null
  const [first, second] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (first === 'channel' && second && CHANNEL_ID.test(second)) return { ids: [second] }
  if (first && HANDLE.test(first)) return { forHandle: first }
  if (first === 'user' && second) return { forUsername: second }
  if (first === 'c' && second) return { forHandle: `@${second}` }
  return null
}
