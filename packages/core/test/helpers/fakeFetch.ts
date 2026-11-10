export interface RecordedRequest {
  method: string
  url: URL
  headers: Record<string, string>
  body: unknown
}

export type FakeReply = { status?: number; body?: unknown } | Error

/**
 * A `fetch` stand-in. Each request is passed to `handler`, which returns the
 * status/JSON to answer with (or an Error to simulate a network failure).
 * All requests are recorded in `requests`.
 */
export function fakeFetch(handler: (req: RecordedRequest, index: number) => FakeReply) {
  const requests: RecordedRequest[] = []
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
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
  }) as typeof fetch
  return { fetch: fn, requests }
}

/** Google API error body, as YouTube returns it. */
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
