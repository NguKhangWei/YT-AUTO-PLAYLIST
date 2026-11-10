import { contractChannel } from '@auto-yt/core/testing'
import { describe, expect, it, vi } from 'vitest'
import { createChannelService, normalizeQuery } from './channels'
import { openDatabase } from './db/database'
import { createSqliteStorage } from './db/sqlite-storage'

const UC = 'UC_x5XG1OV2P6uZZ5FSM9Ttw'

function setup() {
  let now = new Date('2026-11-10T00:00:00Z')
  const storage = createSqliteStorage(openDatabase(':memory:'))
  const found = contractChannel(UC).channel
  const youtube = {
    searchChannels: vi.fn(async () => [found]),
    getChannels: vi.fn(async () => [found]),
  }
  const service = createChannelService({ storage, youtube, now: () => now })
  return {
    service,
    youtube,
    found,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  }
}

describe('normalizeQuery', () => {
  it('ignores case and extra spaces', () => {
    expect(normalizeQuery('  Linus   Tech Tips ')).toBe('linus tech tips')
  })
})

describe('channel search', () => {
  it('searches new text (5 results) and caches it for 24 hours', async () => {
    const t = setup()
    expect(await t.service.search('Linus Tech')).toEqual({ source: 'search', channels: [t.found] })
    expect(t.youtube.searchChannels).toHaveBeenCalledWith('linus tech', 5)

    expect(await t.service.search('  linus   TECH ')).toEqual({
      source: 'cache',
      channels: [t.found],
    })
    expect(t.youtube.searchChannels).toHaveBeenCalledOnce()

    t.advance(24 * 60 * 60 * 1000 + 1)
    expect((await t.service.search('linus tech')).source).toBe('search')
    expect(t.youtube.searchChannels).toHaveBeenCalledTimes(2)
  })

  it('caches empty results too', async () => {
    const t = setup()
    t.youtube.searchChannels.mockResolvedValueOnce([])
    await t.service.search('zzzzzz')
    expect(await t.service.search('zzzzzz')).toEqual({ source: 'cache', channels: [] })
  })

  it('sends nothing for fewer than 3 characters', async () => {
    const t = setup()
    expect(await t.service.search(' ab ')).toEqual({ source: 'tooShort', channels: [] })
    expect(t.youtube.searchChannels).not.toHaveBeenCalled()
  })

  it.each([`https://www.youtube.com/channel/${UC}`, '@mkbhd', UC])(
    'looks up "%s" directly instead of searching',
    async (input) => {
      const t = setup()
      expect(await t.service.search(input)).toEqual({ source: 'lookup', channels: [t.found] })
      expect(t.youtube.searchChannels).not.toHaveBeenCalled()
      expect(t.youtube.getChannels).toHaveBeenCalledOnce()
    },
  )

  it('returns no channels when a lookup finds nothing', async () => {
    const t = setup()
    t.youtube.getChannels.mockResolvedValueOnce([])
    expect(await t.service.search('@nobody-here')).toEqual({ source: 'lookup', channels: [] })
  })

  it('does not cache failed searches', async () => {
    const t = setup()
    t.youtube.searchChannels.mockRejectedValueOnce(new Error('quota'))
    await expect(t.service.search('linus')).rejects.toThrow('quota')
    expect((await t.service.search('linus')).source).toBe('search')
  })
})
