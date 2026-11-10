import { useEffect, useState } from 'react'
import type { ChannelSearchResult } from '../../../shared/api'
import { useApi } from '@/lib/api'

/** Wait this long after the last keystroke before searching (each search costs 100 units). */
export const SEARCH_DEBOUNCE_MS = 600
export const MIN_SEARCH_LENGTH = 3

export type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; result: ChannelSearchResult }
  | { status: 'error'; message: string }

/**
 * Debounced channel search. Only the latest query's answer is shown, so a
 * slow early response can't overwrite a newer one.
 */
export function useChannelSearch(query: string): SearchState {
  const api = useApi()
  const trimmed = query.trim()
  const enabled = trimmed.length >= MIN_SEARCH_LENGTH
  // Results are stored per query; anything not for the current query is ignored.
  const [state, setState] = useState<{ for: string; value: SearchState } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const timer = setTimeout(() => {
      setState({ for: trimmed, value: { status: 'searching' } })
      api.channels.search(trimmed).then(
        (result) => !cancelled && setState({ for: trimmed, value: { status: 'done', result } }),
        (e: Error) =>
          !cancelled && setState({ for: trimmed, value: { status: 'error', message: e.message } }),
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [api, trimmed, enabled])

  if (!enabled) return { status: 'idle' }
  // Typing, before the debounce fires: show "searching" rather than stale results.
  if (!state || state.for !== trimmed) return { status: 'searching' }
  return state.value
}
