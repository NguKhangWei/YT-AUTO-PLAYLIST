// Channel search for the editor, with a direct lookup for pasted URLs and @handles.
import type { YouTubeClient } from './core/youtube/client'
import { channelLookup } from './core/youtube/resolve'
import type { Channel } from './core/youtube/types'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Looks up a pasted channel URL, @handle or id (1 quota unit), or searches by
 * name (101 units). Name searches are cached in memory for 24 hours.
 */
export function createChannelService(deps: {
  youtube: Pick<YouTubeClient, 'searchChannels' | 'getChannels'>
  now: () => Date
}) {
  const cache = new Map<string, { at: number; channels: Channel[] }>()

  return {
    async search(raw: string): Promise<Channel[]> {
      const lookup = channelLookup(raw)
      if (lookup) return (await deps.youtube.getChannels(lookup)).slice(0, 1)

      const query = raw.trim().replace(/\s+/g, ' ').toLowerCase()
      const now = deps.now().getTime()
      const hit = cache.get(query)
      if (hit && now - hit.at < CACHE_TTL_MS) return hit.channels

      const channels = await deps.youtube.searchChannels(query, 5)
      cache.set(query, { at: now, channels })
      return channels
    },
  }
}

export type ChannelService = ReturnType<typeof createChannelService>
