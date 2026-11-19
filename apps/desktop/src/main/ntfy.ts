// Sends notifications as ntfy pushes (the server's replacement for Windows toasts).
import type { NotificationText } from './notifications'

export const NTFY_SERVER = 'https://ntfy.sh'

export interface NtfyOptions {
  topic: string // long and random: anyone who knows it can read the pushes
  server?: string
  fetch?: typeof fetch
  log?: (message: string, error: unknown) => void
}

/**
 * A notifier that publishes to an ntfy topic. It uses ntfy's JSON form, so titles
 * with emoji or non-Latin text arrive intact. Failures are logged, never thrown:
 * a missed push must not fail a scan.
 */
export function createNtfyNotifier(opts: NtfyOptions): (n: NotificationText) => Promise<void> {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const server = (opts.server ?? NTFY_SERVER).replace(/\/+$/, '')
  return async ({ title, body }) => {
    try {
      const res = await doFetch(`${server}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: opts.topic, title, message: body }),
      })
      if (!res.ok) opts.log?.('ntfy push failed', new Error(`HTTP ${res.status}`))
    } catch (e) {
      opts.log?.('ntfy push failed', e)
    }
  }
}
