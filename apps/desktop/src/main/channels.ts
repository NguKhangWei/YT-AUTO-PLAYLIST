import { parseChannelInput, resolveChannel, type Channel, type YouTubeClient } from '@auto-yt/core'
import type { ChannelSearchResult } from '../shared/api'
import type { SqliteStorage } from './db/sqlite-storage'

/** Searches shorter than this aren't sent (each search costs 100 units). */
export const MIN_QUERY_LENGTH = 3
export const SEARCH_RESULTS = 5
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Case- and whitespace-insensitive cache key. */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Channel lookup for the editor:
 * - a pasted URL, @handle or UC id is resolved directly (1 unit),
 * - other text is searched (101 units) unless the same query was searched in
 *   the last 24 hours, in which case the cached results are returned free.
 */
export function createChannelService(deps: {
  storage: Pick<SqliteStorage, 'getCachedSearch' | 'putCachedSearch'>
  youtube: Pick<YouTubeClient, 'searchChannels' | 'getChannels'>
  now: () => Date
}) {
  return {
    async search(raw: string): Promise<ChannelSearchResult> {
      const input = parseChannelInput(raw)
      if (input.kind !== 'query') {
        const channel = await resolveChannel(deps.youtube as YouTubeClient, raw)
        return { source: 'lookup', channels: channel ? [channel] : [] }
      }

      const query = normalizeQuery(input.value)
      if (query.length < MIN_QUERY_LENGTH) return { source: 'tooShort', channels: [] }

      const now = deps.now()
      const cached = deps.storage.getCachedSearch(
        query,
        new Date(now.getTime() - SEARCH_CACHE_TTL_MS),
      )
      if (cached) return { source: 'cache', channels: cached }

      const channels: Channel[] = await deps.youtube.searchChannels(query, SEARCH_RESULTS)
      deps.storage.putCachedSearch(
        query,
        channels,
        now,
        new Date(now.getTime() - SEARCH_CACHE_TTL_MS),
      )
      return { source: 'search', channels }
    },
  }
}

export type ChannelService = ReturnType<typeof createChannelService>
