// Pure OAuth pieces: PKCE, the consent URL and parsing the redirect.
import { createHash, randomBytes } from 'node:crypto'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
export const SCOPES = ['openid', 'profile', 'https://www.googleapis.com/auth/youtube']

/** A random URL-safe string. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** A PKCE verifier and its SHA-256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/** The Google consent URL; offline + consent always yields a refresh token. */
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
    access_type: 'offline',
    prompt: 'consent',
  }).toString()
  return url.toString()
}

export type CallbackResult =
  { kind: 'code'; code: string } | { kind: 'error'; message: string } | { kind: 'ignore' }

/** Reads a request to the loopback server; anything but the redirect (e.g. /favicon.ico) is ignored. */
export function parseCallback(requestUrl: string, expectedState: string): CallbackResult {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  const q = url.searchParams
  if (url.pathname !== '/' || (!q.has('state') && !q.has('code') && !q.has('error'))) {
    return { kind: 'ignore' }
  }
  if (q.get('state') !== expectedState) {
    return {
      kind: 'error',
      message: 'Sign-in response did not match this request. Please try again.',
    }
  }
  const error = q.get('error')
  if (error) {
    const message =
      error === 'access_denied'
        ? 'Sign-in was cancelled in the browser.'
        : `Google sign-in failed: ${error}`
    return { kind: 'error', message }
  }
  const code = q.get('code')
  return code
    ? { kind: 'code', code }
    : { kind: 'error', message: 'Google did not return an authorization code.' }
}
