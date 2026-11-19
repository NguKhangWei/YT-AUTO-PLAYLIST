import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../../../shared/ipc'
import { createHttpApi } from './http-api'

/** A stand-in for the browser's EventSource that tests can drive. */
class FakeEventSource extends EventTarget {
  static last: FakeEventSource | null = null
  constructor(public url: string) {
    super()
    FakeEventSource.last = this
  }
  push(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }))
  }
}
const ES = FakeEventSource as unknown as typeof EventSource

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('createHttpApi', () => {
  it('posts calls with the CSRF header and unwraps the envelope', async () => {
    const fetch = reply({ ok: true, data: [{ id: 's1' }] })
    vi.stubGlobal('fetch', fetch)
    const api = createHttpApi('', ES)
    expect(await api.schedulers.setActive('s1', false)).toEqual([{ id: 's1' }])
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/call/schedulers%3AsetActive')
    expect(init.headers).toMatchObject({ 'X-Auto-Yt': '1' })
    expect(JSON.parse(init.body as string)).toEqual({ args: ['s1', false] })
  })

  it("throws main's error message, and explains a refused Tailscale account", async () => {
    vi.stubGlobal('fetch', reply({ ok: false, error: 'Choose a playlist.' }))
    await expect(createHttpApi('', ES).schedulers.list()).rejects.toThrow('Choose a playlist.')
    vi.stubGlobal('fetch', reply('Forbidden', 403))
    await expect(createHttpApi('', ES).schedulers.list()).rejects.toThrow(/Tailscale account/)
  })

  it('delivers pushes from one shared event stream, and unsubscribes', () => {
    const api = createHttpApi('', ES)
    const paused = vi.fn()
    const stop = api.scans.onPausedChange(paused)
    const runs = vi.fn()
    api.runs.onChange(runs)
    const es = FakeEventSource.last!
    expect(es.url).toBe('/api/events')
    es.push(IPC.scansPausedChanged, true)
    expect(paused).toHaveBeenCalledWith(true)
    stop()
    es.push(IPC.scansPausedChanged, false)
    expect(paused).toHaveBeenCalledTimes(1)
    expect(FakeEventSource.last).toBe(es) // no second stream
  })

  it('refreshes the run list after the stream reconnects', () => {
    const api = createHttpApi('', ES)
    const runs = vi.fn()
    api.runs.onChange(runs)
    const es = FakeEventSource.last!
    es.dispatchEvent(new Event('open'))
    expect(runs).not.toHaveBeenCalled() // first connection: nothing missed
    es.dispatchEvent(new Event('open'))
    expect(runs).toHaveBeenCalledTimes(1)
  })
})
