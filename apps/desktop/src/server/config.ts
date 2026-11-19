// Reads the server's settings from environment variables (/etc/auto-yt/auto-yt.env on the VM).
import { resolve } from 'node:path'

export interface ServerConfig {
  clientId: string
  clientSecret: string
  dataDir: string // auto-yt.db, auth.json and backups/
  port: number // on 127.0.0.1; `tailscale serve` publishes it to your tailnet
  allowedLogin: string // Tailscale login allowed in; '*' only for local testing
  ntfyTopic?: string
  ntfyServer?: string
  shortsProbe: boolean
}

export const MIN_TOPIC_LENGTH = 16 // anyone who guesses the topic can read the pushes

/** The Google client, from the server's names or the desktop .env's MAIN_VITE_ names. */
export function googleClient(env: NodeJS.ProcessEnv): { clientId?: string; clientSecret?: string } {
  return {
    clientId: env['GOOGLE_CLIENT_ID'] || env['MAIN_VITE_GOOGLE_CLIENT_ID'] || undefined,
    clientSecret: env['GOOGLE_CLIENT_SECRET'] || env['MAIN_VITE_GOOGLE_CLIENT_SECRET'] || undefined,
  }
}

/**
 * Validates the environment, throwing one Error that lists every problem.
 * `local` (npm run serve:local) relaxes the settings that only make sense on the VM.
 */
export function loadConfig(env: NodeJS.ProcessEnv, opts: { local?: boolean } = {}): ServerConfig {
  const errors: string[] = []
  const { clientId, clientSecret } = googleClient(env)
  if (!clientId || !clientSecret)
    errors.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.')

  const dataDir = env['AUTO_YT_DATA_DIR'] || (opts.local ? resolve('.local-server') : '')
  if (!dataDir) errors.push('AUTO_YT_DATA_DIR must be set (e.g. /var/lib/auto-yt).')

  const port = Number(env['AUTO_YT_PORT'] || 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    errors.push(`AUTO_YT_PORT must be a port number, not "${env['AUTO_YT_PORT']}".`)
  }

  const allowedLogin = env['AUTO_YT_ALLOWED_LOGIN']?.trim() || (opts.local ? '*' : '')
  if (!allowedLogin) {
    errors.push('AUTO_YT_ALLOWED_LOGIN must be set to your Tailscale login (e.g. you@gmail.com).')
  }

  const ntfyTopic = env['NTFY_TOPIC']?.trim() || undefined
  if (ntfyTopic && (ntfyTopic.length < MIN_TOPIC_LENGTH || !/^[\w-]+$/.test(ntfyTopic))) {
    errors.push(
      `NTFY_TOPIC must be at least ${MIN_TOPIC_LENGTH} letters, digits, "-" or "_": anyone who guesses it can read your notifications.`,
    )
  }

  const probe = (env['SHORTS_PROBE'] || 'on').toLowerCase()
  if (probe !== 'on' && probe !== 'off') errors.push('SHORTS_PROBE must be "on" or "off".')

  if (errors.length > 0) throw new Error(`auto-yt server settings:\n- ${errors.join('\n- ')}`)
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    dataDir,
    port,
    allowedLogin,
    ...(ntfyTopic ? { ntfyTopic } : {}),
    ...(env['NTFY_SERVER'] ? { ntfyServer: env['NTFY_SERVER'] } : {}),
    shortsProbe: probe === 'on',
  }
}
