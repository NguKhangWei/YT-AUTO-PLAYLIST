// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiContext } from '@/lib/api'
import { fakeApi, signedIn } from '@/test/fakeApi'
import { QuotaMeter } from './QuotaMeter'

afterEach(cleanup)

const quota = (used: number) => ({ used, limit: 10_000, resetsAt: '2026-11-11T08:00:00.000Z' })

function setup(used: number) {
  const fake = fakeApi(signedIn, { quota: quota(used) })
  render(
    <ApiContext.Provider value={fake.api}>
      <QuotaMeter />
    </ApiContext.Provider>,
  )
  return fake
}

describe('QuotaMeter', () => {
  it("shows today's usage and updates when main pushes a change", async () => {
    const fake = setup(1234)
    expect(await screen.findByText('API 1,234 / 10,000')).toBeTruthy()
    const meter = screen.getByRole('meter', { name: 'YouTube API quota used today' })
    expect(meter.getAttribute('aria-valuenow')).toBe('1234')

    act(() => fake.emitQuota(quota(1335)))
    expect(screen.getByText('API 1,335 / 10,000')).toBeTruthy()
  })

  it('explains when the quota resets', async () => {
    setup(0)
    const label = await screen.findByText('API 0 / 10,000')
    expect(label.parentElement?.getAttribute('title')).toMatch(/midnight Pacific Time/)
  })
})
