import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { YouTubeApiError } from '@auto-yt/core'
import type { AuthStatus, Profile } from '../../shared/api'
import {
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  buildAuthUrl,
  createPkcePair,
  parseCallback,
  randomToken,
} from './oauth-helpers'
import type { TokenStore } from './token-store'

export interface GoogleAuthOptions {
  /** Undefined when .env isn't filled in yet; the app then shows setup instructions. */
  clientId?: string
  clientSecret?: string
  store: TokenStore
  /** Opens the consent page in the system browser (Electron `shell.openExternal`). */
  openExternal: (url: string) => Promise<void>
  /** For Google token/userinfo/revoke calls. Defaults to global fetch. */
  fetch?: typeof fetch
  now?: () => number
  /** How long to wait for the browser before giving up. Default 5 minutes. */
  timeoutMs?: number
}

/** Refresh this long before the access token actually expires. */
const EXPIRY_SKEW_MS = 60_000

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0">` +
  `<div style="text-align:center"><h2>${title}</h2><p>${body}</p></div>`

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

/**
 * Google OAuth for an installed app: system browser + loopback redirect
 * (127.0.0.1, random port) + PKCE. Embedded Electron windows are refused by
 * Google, so the browser is the only supported way.
 */
export function createGoogleAuth(opts: GoogleAuthOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const now = opts.now ?? Date.now
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000
  const configured = !!opts.clientId && !!opts.clientSecret

  let cached: { token: string; expiresAt: number } | null = null
  let signInFlow: { promise: Promise<AuthStatus>; cancel: () => void } | null = null
  let refreshing: Promise<string> | null = null
  const listeners = new Set<(s: AuthStatus) => void>()

  async function status(): Promise<AuthStatus> {
    const saved = configured ? await opts.store.load() : null
    return {
      configured,
      signedIn: !!saved,
      signingIn: !!signInFlow,
      ...(saved ? { profile: saved.profile } : {}),
    }
  }

  async function emit(): Promise<void> {
    const s = await status()
    for (const l of listeners) l(s)
  }

  async function postToken(
    params: Record<string, string>,
  ): Promise<TokenResponse & { status: number }> {
    let res: Response
    try {
      res = await doFetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: opts.clientId!,
          client_secret: opts.clientSecret!,
          ...params,
        }).toString(),
      })
    } catch (e) {
      throw new YouTubeApiError('network', `Could not reach Google: ${String(e)}`)
    }
    const body = ((await res.json().catch(() => ({}))) ?? {}) as TokenResponse
    return { ...body, status: res.status }
  }

  async function fetchProfile(accessToken: string): Promise<Profile> {
    try {
      const res = await doFetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const info = (await res.json()) as { name?: string; picture?: string }
      return { name: info.name || 'Google account', pictureUrl: info.picture }
    } catch {
      return { name: 'Google account' }
    }
  }

  /** Listen on 127.0.0.1:<random> and resolve with the auth code from the redirect. */
  function startLoopback(state: string) {
    let settle!: { resolve: (code: string) => void; reject: (e: Error) => void }
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
    // Cancel/timeout can reject before runSignIn awaits `code`; don't report that as unhandled.
    code.catch(() => undefined)
    const server: Server = createServer((req, res) => {
      const result = parseCallback(req.url ?? '/', state)
      if (result.kind === 'ignore') {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (result.kind === 'code') {
        res.end(PAGE('Signed in to auto-yt', 'You can close this tab and return to the app.'))
        settle.resolve(result.code)
      } else {
        res.end(PAGE('Sign-in failed', result.message))
        settle.reject(new Error(result.message))
      }
    })
    const listening = new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
    })
    const close = () => {
      server.closeAllConnections()
      server.close()
    }
    return { listening, code, close, fail: (e: Error) => settle.reject(e) }
  }

  async function runSignIn(loopback: ReturnType<typeof startLoopback>, state: string) {
    const port = await loopback.listening
    const redirectUri = `http://127.0.0.1:${port}`
    const { verifier, challenge } = createPkcePair()
    await opts.openExternal(
      buildAuthUrl({ clientId: opts.clientId!, redirectUri, challenge, state }),
    )
    const code = await loopback.code

    const tokens = await postToken({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    })
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error(
        `Google did not issue tokens: ${tokens.error_description ?? tokens.error ?? `HTTP ${tokens.status}`}`,
      )
    }
    const profile = await fetchProfile(tokens.access_token)
    await opts.store.save({ refreshToken: tokens.refresh_token, profile })
    cached = { token: tokens.access_token, expiresAt: now() + (tokens.expires_in ?? 3600) * 1000 }
  }

  return {
    status,

    /** Open the browser and wait for consent. Concurrent calls share one flow. */
    signIn(): Promise<AuthStatus> {
      if (!configured) {
        return Promise.reject(new Error('Google client ID/secret are not set. See README → Setup.'))
      }
      if (signInFlow) return signInFlow.promise

      const state = randomToken(16)
      const loopback = startLoopback(state)
      const timer = setTimeout(
        () => loopback.fail(new Error('Sign-in timed out. Please try again.')),
        timeoutMs,
      )
      const promise = runSignIn(loopback, state)
        .finally(() => {
          clearTimeout(timer)
          loopback.close()
          signInFlow = null // before status(), so the result says signingIn: false
          void emit()
        })
        .then(status)
      signInFlow = { promise, cancel: () => loopback.fail(new Error('Sign-in cancelled.')) }
      void emit()
      return promise
    },

    cancelSignIn(): void {
      signInFlow?.cancel()
    },

    /** Revoke the grant at Google (best effort) and forget it locally. */
    async signOut(): Promise<AuthStatus> {
      const saved = await opts.store.load()
      cached = null
      await opts.store.clear()
      if (saved) {
        await doFetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(saved.refreshToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }).catch(() => undefined)
      }
      await emit()
      return status()
    },

    /**
     * A valid access token for API calls (the core YouTube client's
     * `getAccessToken`). Refreshes when expired or when `forceRefresh` is set.
     * If Google rejects the refresh token (revoked, expired), signs out and
     * throws `YouTubeApiError('unauthorized')`.
     */
    async getAccessToken(o?: { forceRefresh?: boolean }): Promise<string> {
      if (!o?.forceRefresh && cached && cached.expiresAt - EXPIRY_SKEW_MS > now()) {
        return cached.token
      }
      refreshing ??= (async () => {
        const saved = configured ? await opts.store.load() : null
        if (!saved) throw new YouTubeApiError('unauthorized', 'Not signed in to Google.')
        const tokens = await postToken({
          grant_type: 'refresh_token',
          refresh_token: saved.refreshToken,
        })
        if (tokens.error === 'invalid_grant') {
          cached = null
          await opts.store.clear()
          await emit()
          throw new YouTubeApiError(
            'unauthorized',
            'Your Google sign-in expired or was revoked. Please sign in again.',
            tokens.status,
            'invalid_grant',
          )
        }
        if (!tokens.access_token) {
          throw new YouTubeApiError(
            'unknown',
            `Could not refresh Google sign-in: ${tokens.error_description ?? tokens.error ?? `HTTP ${tokens.status}`}`,
            tokens.status,
          )
        }
        cached = {
          token: tokens.access_token,
          expiresAt: now() + (tokens.expires_in ?? 3600) * 1000,
        }
        return tokens.access_token
      })().finally(() => {
        refreshing = null
      })
      return refreshing
    },

    onStatusChange(listener: (s: AuthStatus) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type GoogleAuth = ReturnType<typeof createGoogleAuth>
