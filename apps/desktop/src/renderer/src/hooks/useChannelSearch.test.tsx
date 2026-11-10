// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiContext } from '@/lib/api'
import { channel, fakeApi, signedIn } from '@/test/fakeApi'
import { SEARCH_DEBOUNCE_MS, useChannelSearch } from './useChannelSearch'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function setup(fake = fakeApi(signedIn)) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={fake.api}>{children}</ApiContext.Provider>
  )
  const hook = renderHook(({ q }) => useChannelSearch(q), { wrapper, initialProps: { q: '' } })
  const type = (q: string) => hook.rerender({ q })
  const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  return { ...hook, type, wait, search: fake.api.channels.search }
}

describe('useChannelSearch', () => {
  it('stays idle and sends nothing under 3 characters', async () => {
    const t = setup()
    t.type('ab')
    await t.wait(SEARCH_DEBOUNCE_MS * 2)
    expect(t.result.current).toEqual({ status: 'idle' })
    expect(t.search).not.toHaveBeenCalled()
  })

  it('searches once, 600 ms after the last keystroke', async () => {
    const t = setup()
    t.type('lin')
    await t.wait(300)
    t.type('linu')
    await t.wait(300)
    t.type('linus')
    expect(t.result.current.status).toBe('searching')
    await t.wait(SEARCH_DEBOUNCE_MS - 1)
    expect(t.search).not.toHaveBeenCalled()
    await t.wait(1)
    expect(t.search).toHaveBeenCalledExactlyOnceWith('linus')
    expect(t.result.current).toEqual({
      status: 'done',
      channels: [channel(1), channel(2)],
    })
  })

  it('trims the query', async () => {
    const t = setup()
    t.type('  linus  ')
    await t.wait(SEARCH_DEBOUNCE_MS)
    expect(t.search).toHaveBeenCalledWith('linus')
  })

  it('ignores a slow answer for an older query', async () => {
    const fake = fakeApi(signedIn)
    let resolveOld!: (v: unknown) => void
    fake.api.channels.search.mockImplementationOnce(
      () => new Promise((r) => (resolveOld = r as (v: unknown) => void)),
    )
    const t = setup(fake)
    t.type('first')
    await t.wait(SEARCH_DEBOUNCE_MS) // first search in flight
    t.type('second')
    await t.wait(SEARCH_DEBOUNCE_MS) // second search answered
    await act(async () => resolveOld([channel(9)]))
    expect(t.result.current).toEqual({
      status: 'done',
      channels: [channel(1), channel(2)],
    })
  })

  it('reports errors', async () => {
    const fake = fakeApi(signedIn)
    fake.api.channels.search.mockRejectedValueOnce(new Error('Quota used up'))
    const t = setup(fake)
    t.type('linus')
    await t.wait(SEARCH_DEBOUNCE_MS)
    expect(t.result.current).toEqual({ status: 'error', message: 'Quota used up' })
  })
})
