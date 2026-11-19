// The web server: the window's API calls over HTTP, live updates over SSE, and the web UI files.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import type { IpcResult } from '../shared/api'
import type { Handlers } from '../main/ipc'

export const CSRF_HEADER = 'x-auto-yt' // a custom header forces a CORS preflight we never allow
const MAX_BODY_BYTES = 1_000_000
const HEARTBEAT_MS = 25_000

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export interface WebServerOptions {
  handlers: Handlers
  webDir: string // the built web UI (index.html + assets/)
  allowedLogin: string // Tailscale-User-Login that may use the app; '*' allows anyone
  log?: (message: string, error: unknown) => void
}

function send(res: ServerResponse, status: number, body: string, type = 'text/plain'): void {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` }).end(body)
}

/** True if the request comes from the allowed Tailscale user (set by `tailscale serve`). */
export function isAllowed(req: IncomingMessage, allowedLogin: string): boolean {
  if (allowedLogin === '*') return true
  const login = req.headers['tailscale-user-login']
  return typeof login === 'string' && login.toLowerCase() === allowedLogin.toLowerCase()
}

/** Blocks other websites from calling the API through your browser. */
function isSameOrigin(req: IncomingMessage): boolean {
  if (req.headers[CSRF_HEADER] !== '1') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error('too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** Creates the server; call `broadcast` to push an event to every open window. */
export function createWebServer(opts: WebServerOptions) {
  const webDir = resolve(opts.webDir)
  const clients = new Set<ServerResponse>()

  async function callApi(req: IncomingMessage, res: ServerResponse, channel: string) {
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed')
    if (!isSameOrigin(req)) return send(res, 403, 'Forbidden')
    if (!Object.hasOwn(opts.handlers, channel)) return send(res, 404, 'Unknown call')
    let args: unknown[]
    try {
      const body = (await readJson(req)) as { args?: unknown }
      if (!Array.isArray(body.args)) throw new Error('args must be an array')
      args = body.args
    } catch {
      return send(res, 400, 'Bad request')
    }
    let result: IpcResult<unknown>
    try {
      result = { ok: true, data: (await opts.handlers[channel]!(...args)) ?? null }
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    send(res, 200, JSON.stringify(result), 'application/json')
  }

  function openEvents(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
  }

  async function serveFile(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed')
    let file = resolve(webDir, `.${pathname}`)
    if (file !== webDir && !file.startsWith(webDir + sep)) return send(res, 404, 'Not found')
    let info = await stat(file).catch(() => null)
    if (!info?.isFile()) {
      if (extname(pathname)) return send(res, 404, 'Not found') // a missing asset, not a page
      file = join(webDir, 'index.html') // the app's own routes
      info = await stat(file).catch(() => null)
      if (!info) return send(res, 500, 'The web UI is missing: run npm run build:server.')
    }
    const immutable = file.includes(`${sep}assets${sep}`) // hashed file names
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  }

  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (!isAllowed(req, opts.allowedLogin)) {
      return send(res, 403, 'auto-yt: this Tailscale account is not allowed.')
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      return send(res, 400, 'Bad request')
    }
    const handle = pathname.startsWith('/api/call/')
      ? callApi(req, res, pathname.slice('/api/call/'.length))
      : pathname === '/api/events'
        ? openEvents(req, res)
        : pathname.startsWith('/api/')
          ? send(res, 404, 'Not found')
          : serveFile(req, res, pathname)
    void Promise.resolve(handle).catch((e: unknown) => {
      opts.log?.(`Request ${req.method} ${pathname} failed`, e)
      if (!res.headersSent) send(res, 500, 'Internal error')
      else res.end()
    })
  })

  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n') // keeps proxies from closing idle streams
  }, HEARTBEAT_MS)
  heartbeat.unref()

  return {
    server,
    /** Pushes an event (an IPC push channel) to every open window. */
    broadcast(channel: string, value?: unknown): void {
      const data = JSON.stringify(value ?? null)
      for (const c of clients) c.write(`event: ${channel}\ndata: ${data}\n\n`)
    },
    /** Starts listening on 127.0.0.1 only. */
    listen(port: number): Promise<number> {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          const address = server.address()
          resolveListen(typeof address === 'object' && address ? address.port : port)
        })
      })
    },
    close(): Promise<void> {
      clearInterval(heartbeat)
      for (const c of clients) c.end()
      clients.clear()
      server.closeAllConnections()
      return new Promise((r) => server.close(() => r()))
    },
  }
}

export type WebServer = ReturnType<typeof createWebServer>
