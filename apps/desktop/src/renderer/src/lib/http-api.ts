// The window's API in a browser: calls over HTTP, pushes over one shared EventSource (SSE).
import type { Api, IpcResult } from '../../../shared/api'
import { buildApi } from '../../../shared/api-client'
import { IPC } from '../../../shared/ipc'

const FORBIDDEN =
  'This Tailscale account is not allowed to use auto-yt. Sign in to Tailscale as its owner.'

export function createHttpApi(base = '', EventSourceImpl: typeof EventSource = EventSource): Api {
  let source: EventSource | null = null
  let connectedOnce = false
  const runsListeners = new Set<() => void>()

  /** The shared event stream, opened on first use; it reconnects by itself. */
  function events(): EventSource {
    if (source) return source
    source = new EventSourceImpl(`${base}/api/events`)
    source.addEventListener('open', () => {
      if (connectedOnce) for (const l of runsListeners) l() // missed pushes while away: refresh
      connectedOnce = true
    })
    return source
  }

  return buildApi(
    async (channel, args) => {
      const res = await fetch(`${base}/api/call/${encodeURIComponent(channel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auto-Yt': '1' },
        body: JSON.stringify({ args }),
      })
      if (res.status === 403) throw new Error(FORBIDDEN)
      if (!res.ok) throw new Error(`auto-yt server error (HTTP ${res.status}).`)
      return (await res.json()) as IpcResult<unknown>
    },
    (channel, listener) => {
      const handler = (e: Event) => listener(JSON.parse((e as MessageEvent<string>).data) as never)
      const es = events()
      es.addEventListener(channel, handler)
      const asRuns = channel === IPC.runsChanged ? () => listener(undefined as never) : null
      if (asRuns) runsListeners.add(asRuns)
      return () => {
        es.removeEventListener(channel, handler)
        if (asRuns) runsListeners.delete(asRuns)
      }
    },
  )
}
