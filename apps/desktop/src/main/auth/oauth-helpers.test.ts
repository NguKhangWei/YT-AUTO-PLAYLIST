import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SCOPES, buildAuthUrl, createPkcePair, parseCallback } from './oauth-helpers'

describe('createPkcePair', () => {
  it('creates an RFC 7636 verifier and its S256 challenge', () => {
    const { verifier, challenge } = createPkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]{43,128}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('is random each time', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier)
  })
})

describe('buildAuthUrl', () => {
  it('requests offline YouTube access with PKCE and state', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:5555',
        challenge: 'chal',
        state: 'st',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid.apps.googleusercontent.com',
      redirect_uri: 'http://127.0.0.1:5555',
      response_type: 'code',
      scope: 'openid profile https://www.googleapis.com/auth/youtube',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      access_type: 'offline',
      prompt: 'consent',
    })
    expect(SCOPES).toContain('https://www.googleapis.com/auth/youtube')
  })
})

describe('parseCallback', () => {
  it('returns the code when state matches', () => {
    expect(parseCallback('/?state=s1&code=4%2Fabc&scope=x', 's1')).toEqual({
      kind: 'code',
      code: '4/abc',
    })
  })

  it('rejects a state mismatch (possible CSRF)', () => {
    expect(parseCallback('/?state=other&code=c', 's1')).toMatchObject({ kind: 'error' })
  })

  it('explains a cancelled consent screen', () => {
    expect(parseCallback('/?state=s1&error=access_denied', 's1')).toEqual({
      kind: 'error',
      message: 'Sign-in was cancelled in the browser.',
    })
  })

  it('reports other errors and a missing code', () => {
    expect(parseCallback('/?state=s1&error=invalid_scope', 's1')).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('invalid_scope'),
    })
    expect(parseCallback('/?state=s1', 's1')).toMatchObject({ kind: 'error' })
  })

  it('ignores unrelated requests such as the favicon', () => {
    expect(parseCallback('/favicon.ico', 's1')).toEqual({ kind: 'ignore' })
    expect(parseCallback('/', 's1')).toEqual({ kind: 'ignore' })
  })
})
