import { describe, expect, it, vi } from 'vitest'
import { createChannelService } from './channels'
import { tracked } from './test/fixtures'

const UC = 'UC_x5XG1OV2P6uZZ5FSM9Ttw'

function setup() {
  let now = new Date('2026-11-10T00:00:00Z')
  const found = tracked(UC).channel
  const youtube = {
    searchChannels: vi.fn(async () => [found]),
    getChannels: vi.fn(async () => [found]),
  }
  const service = createChannelService({ youtube, now: () => now })
  return { service, youtube, found, advance: (ms: number) => (now = new Date(now.getTime() + ms)) }
}

describe('channel search', () => {
  it('searches new text (top 5) and caches it for 24 hours, ignoring case and spacing', async () => {
    const t = setup()
    expect(await t.service.search('Linus Tech')).toEqual([t.found])
    expect(t.youtube.searchChannels).toHaveBeenCalledWith('linus tech', 5)

    expect(await t.service.search('  linus   TECH ')).toEqual([t.found])
    expect(t.youtube.searchChannels).toHaveBeenCalledOnce()

    t.advance(24 * 60 * 60 * 1000 + 1)
    await t.service.search('linus tech')
    expect(t.youtube.searchChannels).toHaveBeenCalledTimes(2)
  })

  it('caches empty results too', async () => {
    const t = setup()
    t.youtube.searchChannels.mockResolvedValueOnce([])
    await t.service.search('zzzzzz')
    expect(await t.service.search('zzzzzz')).toEqual([])
    expect(t.youtube.searchChannels).toHaveBeenCalledOnce()
  })

  it.each([`https://www.youtube.com/channel/${UC}`, '@mkbhd', UC])(
    'looks up "%s" directly instead of searching',
    async (input) => {
      const t = setup()
      expect(await t.service.search(input)).toEqual([t.found])
      expect(t.youtube.searchChannels).not.toHaveBeenCalled()
      expect(t.youtube.getChannels).toHaveBeenCalledOnce()
    },
  )

  it('returns nothing when a lookup finds no channel', async () => {
    const t = setup()
    t.youtube.getChannels.mockResolvedValueOnce([])
    expect(await t.service.search('@nobody-here')).toEqual([])
  })

  it('does not cache failed searches', async () => {
    const t = setup()
    t.youtube.searchChannels.mockRejectedValueOnce(new Error('quota'))
    await expect(t.service.search('linus')).rejects.toThrow('quota')
    expect(await t.service.search('linus')).toEqual([t.found])
  })
})
