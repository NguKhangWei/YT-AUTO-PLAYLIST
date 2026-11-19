import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWebServer, type WebServer } from './http'

let dir: string
let web: WebServer
let base: string

async function start(allowedLogin = 'me@gmail.com') {
  web = createWebServer({
    allowedLogin,
    webDir: dir,
    handlers: {
      'math:add': (a: number, b: number) => a + b,
      'math:fail': () => {
        throw new Error('That scheduler no longer exists.')
      },
      'math:nothing': () => undefined,
    },
  })
  base = `http://127.0.0.1:${await web.listen(0)}`
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'auto-yt-web-'))
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  await writeFile(join(dir, 'assets', 'app-123.js'), 'console.log(1)')
  await writeFile(join(tmpdir(), 'auto-yt-secret.txt'), 'secret')
})
afterEach(async () => {
  await web?.close()
  await rm(dir, { recursive: true, force: true })
  await rm(join(tmpdir(), 'auto-yt-secret.txt'), { force: true })
})

const me = { 'Tailscale-User-Login': 'Me@Gmail.com' }
const call = (channel: string, args: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/call/${channel}`, {
    method: 'POST',
    headers: { ...me, 'Content-Type': 'application/json', 'X-Auto-Yt': '1', ...headers },
    body: JSON.stringify({ args }),
  })

/** A raw GET, so `..` reaches the server unnormalized. */
const rawGet = (path: string) =>
  new Promise<number>((resolve, reject) => {
    const url = new URL(base)
    request({ host: url.hostname, port: url.port, path, headers: me }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
      .on('error', reject)
      .end()
  })

describe('web server', () => {
  it('only lets the allowed Tailscale user in (case-insensitive)', async () => {
    await start()
    expect((await fetch(`${base}/`)).status).toBe(403)
    expect(
      (await fetch(`${base}/`, { headers: { 'Tailscale-User-Login': 'other@gmail.com' } })).status,
    ).toBe(403)
    expect((await fetch(`${base}/`, { headers: me })).status).toBe(200)
  })

  it('"*" (local testing) lets anyone in', async () => {
    await start('*')
    expect((await fetch(`${base}/`)).status).toBe(200)
  })

  it('serves the UI, its assets, and index.html for app routes', async () => {
    await start()
    const page = await fetch(`${base}/`, { headers: me })
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('cache-control')).toBe('no-cache')
    const asset = await fetch(`${base}/assets/app-123.js`, { headers: me })
    expect(await asset.text()).toBe('console.log(1)')
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect(await (await fetch(`${base}/history`, { headers: me })).text()).toContain('root')
    expect((await fetch(`${base}/assets/missing.js`, { headers: me })).status).toBe(404)
  })

  it('never serves files outside the UI folder', async () => {
    await start()
    expect(await rawGet('/../auto-yt-secret.txt')).not.toBe(200)
    expect(await rawGet('/%2e%2e/auto-yt-secret.txt')).toBe(404)
    expect(await rawGet('/..%2fauto-yt-secret.txt')).toBe(404)
  })

  it('answers calls in the same envelope as Electron IPC', async () => {
    await start()
    expect(await (await call('math:add', [2, 3])).json()).toEqual({ ok: true, data: 5 })
    expect(await (await call('math:fail', [])).json()).toEqual({
      ok: false,
      error: 'That scheduler no longer exists.',
    })
    expect(await (await call('math:nothing', [])).json()).toEqual({ ok: true, data: null })
  })

  it('rejects unknown calls, bad bodies and other methods', async () => {
    await start()
    expect((await call('toString', [])).status).toBe(404) // not inherited properties
    expect((await call('math:add', 'not an array')).status).toBe(400)
    const get = await fetch(`${base}/api/call/math:add`, { headers: me })
    expect(get.status).toBe(405)
    expect((await fetch(`${base}/api/other`, { headers: me })).status).toBe(404)
  })

  it('rejects calls from other websites (missing header or foreign origin)', async () => {
    await start()
    const noHeader = await fetch(`${base}/api/call/math:add`, {
      method: 'POST',
      headers: { ...me, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ args: [1, 2] }),
    })
    expect(noHeader.status).toBe(403)
    expect((await call('math:add', [1, 2], { Origin: 'https://evil.example' })).status).toBe(403)
    expect((await call('math:add', [1, 2], { Origin: base })).status).toBe(200)
  })

  it('pushes events to open windows over SSE', async () => {
    await start()
    const res = await fetch(`${base}/api/events`, { headers: me })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = decoder.decode((await reader.read()).value)
    expect(text).toContain(': connected')
    web.broadcast('scans:pausedChanged', true)
    while (!text.includes('data: true')) text += decoder.decode((await reader.read()).value)
    expect(text).toContain('event: scans:pausedChanged\ndata: true\n\n')
    await reader.cancel()
  })
})
