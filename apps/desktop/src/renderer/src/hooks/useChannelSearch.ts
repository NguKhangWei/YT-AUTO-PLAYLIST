// Debounced channel search for the editor.
import { useEffect, useState } from 'react'
import type { Channel } from '../../../shared/api'
import { MIN_SEARCH_LENGTH } from '../../../shared/constants'
import { useApi } from '@/lib/api'

export const SEARCH_DEBOUNCE_MS = 600 // a search costs 100 quota units

export type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; channels: Channel[] }
  | { status: 'error'; message: string }

/** Searches 600 ms after typing stops; answers for older queries are ignored. */
export function useChannelSearch(query: string): SearchState {
  const api = useApi()
  const trimmed = query.trim()
  const enabled = trimmed.length >= MIN_SEARCH_LENGTH
  const [state, setState] = useState<{ query: string; value: SearchState } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const timer = setTimeout(() => {
      setState({ query: trimmed, value: { status: 'searching' } })
      api.channels.search(trimmed).then(
        (channels) =>
          !cancelled && setState({ query: trimmed, value: { status: 'done', channels } }),
        (e: Error) =>
          !cancelled &&
          setState({ query: trimmed, value: { status: 'error', message: e.message } }),
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [api, trimmed, enabled])

  if (!enabled) return { status: 'idle' }
  if (state?.query !== trimmed) return { status: 'searching' } // still typing
  return state.value
}
