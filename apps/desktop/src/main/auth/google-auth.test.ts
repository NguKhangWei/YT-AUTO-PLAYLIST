import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AuthStatus } from '../../shared/api'
import { createGoogleAuth, type GoogleAuthOptions } from './google-auth'
import { GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL } from './oauth-helpers'
import type { StoredAuth, TokenStore } from './token-store'

function memoryStore(initial: StoredAuth | null = null): TokenStore & { value: StoredAuth | null } {
  const s = {
    value: initial,
    load: async () => s.value,
    save: async (a: StoredAuth) => void (s.value = a),
    clear: async () => void (s.value = null),
  }
  return s
}

type GoogleReply = { status?: number; body: unknown }

/** Fake Google endpoints. Records form bodies sent to the token endpoint. */
function fakeGoogle(token: (form: URLSearchParams) => GoogleReply) {
  const tokenForms: URLSearchParams[] = []
  const revoked: string[] = []
  const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const json = (r: GoogleReply) =>
      new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
    if (url.href === GOOGLE_TOKEN_URL) {
      const form = new URLSearchParams(String(init?.body))
      tokenForms.push(form)
      return json(token(form))
    }
    if (url.href === GOOGLE_USERINFO_URL) {
      return json({ body: { name: 'Khang Wei', picture: 'https://lh3.googleusercontent.com/a/p' } })
    }
    if (url.origin + url.pathname === GOOGLE_REVOKE_URL) {
      revoked.push(url.searchParams.get('token')!)
      return json({ body: {} })
    }
    throw new Error(`unexpected fetch ${url.href}`)
  }) as unknown as typeof fetch
  return { fetch: fakeFetch, tokenForms, revoked }
}

const issued = (form: URLSearchParams): GoogleReply =>
  form.get('grant_type') === 'authorization_code'
    ? { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 } }
    : { body: { access_token: `at-refreshed`, expires_in: 3600 } }

/** Plays the browser: follows the consent URL straight to the loopback redirect. */
function browserThatConsents(params: (authUrl: URL) => Record<string, string> = () => ({})) {
  const opened: URL[] = []
  const openExternal = async (url: string) => {
    const authUrl = new URL(url)
    opened.push(authUrl)
    const redirect = new URL(authUrl.searchParams.get('redirect_uri')!)
    redirect.search = new URLSearchParams({
      state: authUrl.searchParams.get('state')!,
      code: 'auth-code',
      ...params(authUrl),
    }).toString()
    const page = await fetch(redirect) // real HTTP request to the loopback server
    await page.text()
  }
  return { openExternal, opened }
}

function setup(over: Partial<GoogleAuthOptions> = {}, store = memoryStore()) {
  const google = fakeGoogle(issued)
  const browser = browserThatConsents()
  let clock = 1_000_000
  const auth = createGoogleAuth({
    clientId: 'cid',
    clientSecret: 'secret',
    store,
    openExternal: browser.openExternal,
    fetch: google.fetch,
    now: () => clock,
    ...over,
  })
  return { auth, store, google, browser, tick: (ms: number) => (clock += ms) }
}

describe('status', () => {
  it('is unconfigured without a client id/secret', async () => {
    const { auth } = setup({ clientId: '', clientSecret: undefined })
    expect(await auth.status()).toEqual({ configured: false, signedIn: false, signingIn: false })
    await expect(auth.signIn()).rejects.toThrow(/not set/)
  })

  it('is signed in when a refresh token is stored', async () => {
    const { auth } = setup({}, memoryStore({ refreshToken: 'rt', profile: { name: 'A' } }))
    expect(await auth.status()).toEqual({
      configured: true,
      signedIn: true,
      signingIn: false,
      profile: { name: 'A' },
    })
  })
})

describe('signIn (loopback + PKCE)', () => {
  it('opens the browser, receives the code on 127.0.0.1 and stores the refresh token', async () => {
    const { auth, store, google, browser } = setup()
    const status = await auth.signIn()

    expect(status).toEqual({
      configured: true,
      signedIn: true,
      signingIn: false,
      profile: { name: 'Khang Wei', pictureUrl: 'https://lh3.googleusercontent.com/a/p' },
    })
    expect(store.value?.refreshToken).toBe('rt-1')

    const authUrl = browser.opened[0]!
    expect(authUrl.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const form = google.tokenForms[0]!
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code')).toBe('auth-code')
    expect(form.get('redirect_uri')).toBe(authUrl.searchParams.get('redirect_uri'))
    // The verifier sent with the code matches the challenge sent to the browser.
    const challenge = createHash('sha256').update(form.get('code_verifier')!).digest('base64url')
    expect(challenge).toBe(authUrl.searchParams.get('code_challenge'))

    // The fresh access token is cached: no refresh call needed.
    expect(await auth.getAccessToken()).toBe('at-1')
    expect(google.tokenForms).toHaveLength(1)
  })

  it('reports signingIn while waiting and notifies listeners', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const browser = browserThatConsents()
    const { auth } = setup({
      openExternal: async (url) => {
        await gate
        await browser.openExternal(url)
      },
    })
    const seen: AuthStatus[] = []
    auth.onStatusChange((s) => seen.push(s))
    const p = auth.signIn()
    expect(auth.signIn()).toBe(p) // concurrent calls share one flow
    await vi.waitFor(() => expect(seen.at(-1)?.signingIn).toBe(true))
    release()
    await p
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ signingIn: false, signedIn: true }))
  })

  it('fails cleanly when the user cancels on the consent screen', async () => {
    const browser = browserThatConsents(() => ({ error: 'access_denied', code: '' }))
    const { auth, store } = setup({ openExternal: browser.openExternal })
    await expect(auth.signIn()).rejects.toThrow('Sign-in was cancelled in the browser.')
    expect(store.value).toBeNull()
    expect((await auth.status()).signingIn).toBe(false)
  })

  it('can be cancelled from the app, and times out', async () => {
    const { auth } = setup({ openExternal: async () => undefined })
    const p = auth.signIn()
    await vi.waitFor(async () => expect((await auth.status()).signingIn).toBe(true))
    auth.cancelSignIn()
    await expect(p).rejects.toThrow('Sign-in cancelled.')

    const timed = setup({ openExternal: async () => undefined, timeoutMs: 20 })
    await expect(timed.auth.signIn()).rejects.toThrow(/timed out/)
  })

  it('fails when Google issues no refresh token', async () => {
    const google = fakeGoogle(() => ({ body: { access_token: 'at' } }))
    const { auth, store } = setup({ fetch: google.fetch })
    await expect(auth.signIn()).rejects.toThrow(/did not issue tokens/)
    expect(store.value).toBeNull()
  })
})

describe('getAccessToken', () => {
  const signedIn = () => memoryStore({ refreshToken: 'rt-saved', profile: { name: 'A' } })

  it('refreshes with the stored refresh token, then caches until near expiry', async () => {
    const { auth, google, tick } = setup({}, signedIn())
    expect(await auth.getAccessToken()).toBe('at-refreshed')
    expect(google.tokenForms[0]?.get('refresh_token')).toBe('rt-saved')
    tick(3600_000 - 61_000)
    await auth.getAccessToken()
    expect(google.tokenForms).toHaveLength(1)
    tick(2_000) // within the 60 s skew
    await auth.getAccessToken()
    expect(google.tokenForms).toHaveLength(2)
  })

  it('refreshes when forced (after an API 401)', async () => {
    const { auth, google } = setup({}, signedIn())
    await auth.getAccessToken()
    await auth.getAccessToken({ forceRefresh: true })
    expect(google.tokenForms).toHaveLength(2)
  })

  it('shares one refresh between concurrent callers', async () => {
    const { auth, google } = setup({}, signedIn())
    await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()])
    expect(google.tokenForms).toHaveLength(1)
  })

  it('signs out and throws unauthorized when the refresh token was revoked', async () => {
    const google = fakeGoogle(() => ({ status: 400, body: { error: 'invalid_grant' } }))
    const { auth, store } = setup({ fetch: google.fetch }, signedIn())
    const seen: AuthStatus[] = []
    auth.onStatusChange((s) => seen.push(s))
    await expect(auth.getAccessToken()).rejects.toMatchObject({
      name: 'YouTubeApiError',
      kind: 'unauthorized',
      reason: 'invalid_grant',
    })
    expect(store.value).toBeNull()
    expect(seen.at(-1)?.signedIn).toBe(false)
  })

  it('throws unauthorized when not signed in, and network on connection failure', async () => {
    await expect(setup().auth.getAccessToken()).rejects.toMatchObject({ kind: 'unauthorized' })
    const offline = setup(
      {
        fetch: (async () => {
          throw new TypeError('fetch failed')
        }) as unknown as typeof fetch,
      },
      signedIn(),
    )
    await expect(offline.auth.getAccessToken()).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('signOut', () => {
  it('revokes the grant at Google and forgets it locally', async () => {
    const { auth, store, google } = setup(
      {},
      memoryStore({ refreshToken: 'rt-x', profile: { name: 'A' } }),
    )
    const status = await auth.signOut()
    expect(google.revoked).toEqual(['rt-x'])
    expect(store.value).toBeNull()
    expect(status.signedIn).toBe(false)
    await expect(auth.getAccessToken()).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('still signs out locally when revoking fails (offline)', async () => {
    const store = memoryStore({ refreshToken: 'rt-x', profile: { name: 'A' } })
    const { auth } = setup(
      {
        fetch: (async () => {
          throw new TypeError('offline')
        }) as unknown as typeof fetch,
      },
      store,
    )
    expect((await auth.signOut()).signedIn).toBe(false)
  })
})
