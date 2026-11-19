import { describe, expect, it, vi } from 'vitest'
import { createNtfyNotifier } from './ntfy'

const ok = () => Promise.resolve(new Response('{}', { status: 200 }))

describe('createNtfyNotifier', () => {
  it('publishes the title and body as JSON to the topic', async () => {
    const fetch = vi.fn(ok)
    await createNtfyNotifier({ topic: 'auto-yt-abc', fetch })({
      title: 'Added 2 videos to Fun 🎮',
      body: '• Ünïcödé title\n• Another',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ntfy.sh/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      topic: 'auto-yt-abc',
      title: 'Added 2 videos to Fun 🎮',
      message: '• Ünïcödé title\n• Another',
    })
  })

  it('uses another server without a doubled slash', async () => {
    const fetch = vi.fn(ok)
    await createNtfyNotifier({ topic: 't', server: 'https://ntfy.example/', fetch })({
      title: 'x',
      body: 'y',
    })
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://ntfy.example/')
  })

  it('logs failures instead of throwing', async () => {
    const log = vi.fn()
    const notify = createNtfyNotifier({
      topic: 't',
      log,
      fetch: vi.fn(() => Promise.resolve(new Response('', { status: 500 }))),
    })
    await expect(notify({ title: 'x', body: 'y' })).resolves.toBeUndefined()
    const offline = createNtfyNotifier({
      topic: 't',
      log,
      fetch: vi.fn(() => Promise.reject(new Error('offline'))),
    })
    await expect(offline({ title: 'x', body: 'y' })).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledTimes(2)
  })
})
