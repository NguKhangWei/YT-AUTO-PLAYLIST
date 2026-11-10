// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../../shared/api'
import { ApiContext } from '@/lib/api'
import { channel, fakeApi, signedIn } from '@/test/fakeApi'
import { ChannelPicker } from './ChannelPicker'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function setup(initial: Channel[] = [], fake = fakeApi(signedIn)) {
  const changes: Channel[][] = []
  function Harness() {
    const [selected, setSelected] = useState(initial)
    return (
      <ChannelPicker
        selected={selected}
        onChange={(c) => {
          changes.push(c)
          setSelected(c)
        }}
      />
    )
  }
  render(
    <ApiContext.Provider value={fake.api}>
      <Harness />
    </ApiContext.Provider>,
  )
  const type = async (q: string) => {
    fireEvent.change(screen.getByLabelText('Channels to track'), { target: { value: q } })
    await act(() => vi.advanceTimersByTimeAsync(600))
  }
  return { type, changes, fake }
}

describe('ChannelPicker', () => {
  it('shows results with avatar, name, @handle and subscribers, and adds a channel', async () => {
    const t = setup()
    await t.type('channel')
    const results = screen.getByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Channel 1')).toBeTruthy()
    expect(within(results).getAllByText('@channel1 · 1.3M subscribers')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Add Channel 1' }))
    const chips = screen.getByRole('list', { name: 'Tracked channels' })
    expect(within(chips).getByText('Channel 1')).toBeTruthy()
    // Already added: marked and not addable twice.
    const added = screen.getByRole('button', { name: 'Added Channel 1' }) as HTMLButtonElement
    expect(added.disabled).toBe(true)
    expect(t.changes).toEqual([[channel(1)]])
  })

  it('removes a tracked channel', () => {
    const t = setup([channel(1), channel(2)])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Channel 1' }))
    expect(t.changes).toEqual([[channel(2)]])
  })

  it('shows hidden subscriber counts as just the handle', async () => {
    setup(
      [],
      fakeApi(signedIn, {
        search: () => ({
          source: 'search',
          channels: [channel(3, { subscriberCount: undefined })],
        }),
      }),
    )
    fireEvent.change(screen.getByLabelText('Channels to track'), { target: { value: 'abc' } })
    await act(() => vi.advanceTimersByTimeAsync(600))
    expect(screen.getByText('@channel3')).toBeTruthy()
  })

  it('explains short input, empty results and errors', async () => {
    const fake = fakeApi(signedIn, { search: () => ({ source: 'search', channels: [] }) })
    const t = setup([], fake)
    await t.type('ab')
    expect(screen.getByText('Type at least 3 characters.')).toBeTruthy()
    await t.type('nothing here')
    expect(screen.getByText('No channels found.')).toBeTruthy()

    fake.api.channels.search.mockRejectedValueOnce(new Error('Quota used up'))
    await t.type('something else')
    expect(screen.getByRole('alert').textContent).toBe('Search failed: Quota used up')
  })

  it('tells the user what searches cost', () => {
    setup()
    expect(screen.getByText(/100 of your 10,000 daily API units/)).toBeTruthy()
  })
})
