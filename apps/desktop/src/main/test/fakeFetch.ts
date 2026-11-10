// Replaces global fetch for a test and records every request (restored after each test).
import { vi } from 'vitest'

export interface RecordedRequest {
  method: string
  url: URL
  headers: Record<string, string>
  body: unknown
}

export type FakeReply = { status?: number; body?: unknown } | Error // an Error simulates a network failure

/** Answers each request with `handler`'s reply; returns the list of recorded requests. */
export function stubFetch(handler: (req: RecordedRequest, index: number) => FakeReply) {
  const requests: RecordedRequest[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const req: RecordedRequest = {
      method: init.method ?? 'GET',
      url: new URL(String(input)),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    requests.push(req)
    const reply = handler(req, requests.length - 1)
    if (reply instanceof Error) throw reply
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return requests
}

export const googleError = (code: number, reason: string, message = reason) => ({
  error: { code, message, errors: [{ reason, domain: 'youtube' }] },
})

export const rawChannel = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: `Channel ${id}`,
    customUrl: `@${id.toLowerCase()}`,
    thumbnails: {
      default: { url: `https://yt3.ggpht.com/${id}-s` },
      medium: { url: `https://yt3.ggpht.com/${id}-m` },
    },
  },
  contentDetails: { relatedPlaylists: { uploads: id.replace(/^UC/, 'UU') } },
  statistics: { subscriberCount: '1234', hiddenSubscriberCount: false },
  ...over,
})
