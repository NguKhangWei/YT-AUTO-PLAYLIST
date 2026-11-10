// Google sign-in for a desktop app: system browser, loopback redirect and PKCE.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AuthStatus, Profile } from '../../shared/api'
import { YouTubeApiError } from '../core/youtube/errors'
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
  clientId?: string // unset until .env is filled in
  clientSecret?: string
  store: TokenStore
  openExternal: (url: string) => Promise<void>
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number // default 5 minutes
}

const EXPIRY_SKEW_MS = 60_000 // refresh a minute before the token expires

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0">` +
  `<div style="text-align:center"><h2>${title}</h2><p>${body}</p></div>`

/**
 * Creates the sign-in service. Google refuses sign-in inside embedded
 * windows, so consent happens in the browser and comes back to a one-off
 * server on 127.0.0.1.
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

  function cache(tokens: TokenResponse): void {
    cached = {
      token: tokens.access_token!,
      expiresAt: now() + (tokens.expires_in ?? 3600) * 1000,
    }
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

  /** Listens on a random 127.0.0.1 port and resolves `code` with the code from the redirect. */
  function startLoopback(state: string) {
    let settle!: { resolve: (code: string) => void; reject: (e: Error) => void }
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
    code.catch(() => undefined) // a cancel can reject before anyone awaits `code`
    const server = createServer((req, res) => {
      const result = parseCallback(req.url ?? '/', state)
      if (result.kind === 'ignore') {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (result.kind === 'code') {
        res.end(page('Signed in to auto-yt', 'You can close this tab and return to the app.'))
        settle.resolve(result.code)
      } else {
        res.end(page('Sign-in failed', result.message))
        settle.reject(new Error(result.message))
      }
    })
    const port = new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
    })
    const close = () => {
      server.closeAllConnections()
      server.close()
    }
    return { port, code, close, fail: (e: Error) => settle.reject(e) }
  }

  async function runSignIn(loopback: ReturnType<typeof startLoopback>, state: string) {
    const redirectUri = `http://127.0.0.1:${await loopback.port}`
    const { verifier, challenge } = createPkcePair()
    await opts.openExternal(
      buildAuthUrl({ clientId: opts.clientId!, redirectUri, challenge, state }),
    )
    const tokens = await postToken({
      grant_type: 'authorization_code',
      code: await loopback.code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    })
    if (!tokens.access_token || !tokens.refresh_token) {
      const why = tokens.error_description ?? tokens.error ?? `HTTP ${tokens.status}`
      throw new Error(`Google did not issue tokens: ${why}`)
    }
    const profile = await fetchProfile(tokens.access_token)
    await opts.store.save({ refreshToken: tokens.refresh_token, profile })
    cache(tokens)
  }

  return {
    status,

    /** Opens the browser and waits for consent; concurrent calls share one sign-in. */
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
          signInFlow = null // cleared before status(), so the result isn't "signing in"
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

    /** Revokes access at Google (best effort) and forgets the sign-in. */
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
     * A valid access token, refreshed when expired or forced. Concurrent callers
     * share one refresh. A revoked sign-in signs out and throws 'unauthorized'.
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
          )
        }
        if (!tokens.access_token) {
          const why = tokens.error_description ?? tokens.error ?? `HTTP ${tokens.status}`
          throw new YouTubeApiError('unknown', `Could not refresh Google sign-in: ${why}`)
        }
        cache(tokens)
        return tokens.access_token
      })().finally(() => (refreshing = null))
      return refreshing
    },

    onStatusChange(listener: (s: AuthStatus) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type GoogleAuth = ReturnType<typeof createGoogleAuth>
