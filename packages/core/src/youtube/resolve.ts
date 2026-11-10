import type { YouTubeClient } from './client'
import type { Channel } from './types'

/** What the user typed into the channel box, interpreted. */
export type ChannelInput =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }
  | { kind: 'username'; value: string }
  | { kind: 'custom'; value: string }
  | { kind: 'query'; value: string }

const CHANNEL_ID = /^UC[\w-]{22}$/
// Handles: 3–30 chars of letters (any script), digits, "_", "-", ".".
const HANDLE = /^@([\p{L}\p{N}_.-]{3,30})$/u
const YOUTUBE_HOST = /^(?:www\.|m\.|music\.)?youtube\.com$/i

/**
 * Interpret channel box input without any network call. Recognises:
 * - channel ids: `UCxxxxxxxxxxxxxxxxxxxxxx`
 * - handles: `@name`
 * - URLs (scheme optional): `youtube.com/channel/UC…`, `/@name`, `/user/name`, `/c/name`,
 *   with any trailing path such as `/videos`
 * Anything else is a search query.
 */
export function parseChannelInput(raw: string): ChannelInput {
  const input = raw.trim()
  if (CHANNEL_ID.test(input)) return { kind: 'id', value: input }
  if (HANDLE.test(input)) return { kind: 'handle', value: input }

  const url = tryParseUrl(input)
  if (url && YOUTUBE_HOST.test(url.hostname)) {
    const [first, second] = url.pathname
      .split('/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s))
    if (first === 'channel' && second && CHANNEL_ID.test(second)) {
      return { kind: 'id', value: second }
    }
    if (first?.startsWith('@') && HANDLE.test(first)) return { kind: 'handle', value: first }
    if (first === 'user' && second) return { kind: 'username', value: second }
    if (first === 'c' && second) return { kind: 'custom', value: second }
  }
  return { kind: 'query', value: input }
}

function tryParseUrl(input: string): URL | null {
  if (!/^(https?:\/\/)?([\w-]+\.)*youtube\.com\//i.test(input)) return null
  try {
    return new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
}

/**
 * Look up a channel from an id, handle or URL (1 unit, no search quota).
 * Returns null when it doesn't exist, or when the input is a plain search
 * query (the UI uses `searchChannels` for those). Legacy `/c/` names are tried
 * as a handle, which matches most channels that migrated to handles.
 */
export async function resolveChannel(client: YouTubeClient, raw: string): Promise<Channel | null> {
  const input = parseChannelInput(raw)
  let found: Channel[]
  switch (input.kind) {
    case 'id':
      found = await client.getChannels({ ids: [input.value] })
      break
    case 'handle':
      found = await client.getChannels({ forHandle: input.value })
      break
    case 'username':
      found = await client.getChannels({ forUsername: input.value })
      break
    case 'custom':
      found = await client.getChannels({ forHandle: `@${input.value}` })
      break
    case 'query':
      return null
  }
  return found[0] ?? null
}
