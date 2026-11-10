import { createHash, randomBytes } from 'node:crypto'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

/** YouTube manage access (needed to add to playlists) plus name/picture for the header. */
export const SCOPES = ['openid', 'profile', 'https://www.googleapis.com/auth/youtube']

const base64url = (buf: Buffer) => buf.toString('base64url')

/** Random URL-safe string with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes))
}

/** PKCE (RFC 7636) S256 pair: a 43-char verifier and its SHA-256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32)
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function buildAuthUrl(p: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
}): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    // offline + consent: always get a refresh token, even on re-login.
    access_type: 'offline',
    prompt: 'consent',
  }).toString()
  return url.toString()
}

export type CallbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  /** Not the OAuth redirect (e.g. /favicon.ico): ignore and keep waiting. */
  | { kind: 'ignore' }

/** Interpret a request to the loopback redirect server. */
export function parseCallback(requestUrl: string, expectedState: string): CallbackResult {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  if (url.pathname !== '/') return { kind: 'ignore' }
  const q = url.searchParams
  if (!q.has('state') && !q.has('code') && !q.has('error')) return { kind: 'ignore' }
  if (q.get('state') !== expectedState) {
    return {
      kind: 'error',
      message: 'Sign-in response did not match this request. Please try again.',
    }
  }
  const error = q.get('error')
  if (error) {
    return {
      kind: 'error',
      message:
        error === 'access_denied'
          ? 'Sign-in was cancelled in the browser.'
          : `Google sign-in failed: ${error}`,
    }
  }
  const code = q.get('code')
  if (!code) return { kind: 'error', message: 'Google did not return an authorization code.' }
  return { kind: 'code', code }
}
