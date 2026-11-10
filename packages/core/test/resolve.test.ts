import { describe, expect, it } from 'vitest'
import { createYouTubeClient, parseChannelInput, resolveChannel } from '../src'
import { fakeFetch, rawChannel } from './helpers/fakeFetch'

const ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw' // 24 chars

describe('parseChannelInput', () => {
  it.each([
    [ID, { kind: 'id', value: ID }],
    [`  ${ID}  `, { kind: 'id', value: ID }],
    ['@mkbhd', { kind: 'handle', value: '@mkbhd' }],
    ['@some.name-1_x', { kind: 'handle', value: '@some.name-1_x' }],
    ['@日本語チャンネル', { kind: 'handle', value: '@日本語チャンネル' }],
    [`https://www.youtube.com/channel/${ID}`, { kind: 'id', value: ID }],
    [`youtube.com/channel/${ID}/videos`, { kind: 'id', value: ID }],
    ['https://youtube.com/@mkbhd', { kind: 'handle', value: '@mkbhd' }],
    ['https://m.youtube.com/@mkbhd/featured?si=abc', { kind: 'handle', value: '@mkbhd' }],
    ['www.youtube.com/@mkbhd', { kind: 'handle', value: '@mkbhd' }],
    ['https://www.youtube.com/%40mkbhd', { kind: 'handle', value: '@mkbhd' }],
    [
      'https://www.youtube.com/user/GoogleDevelopers',
      { kind: 'username', value: 'GoogleDevelopers' },
    ],
    ['https://www.youtube.com/c/LinusTechTips', { kind: 'custom', value: 'LinusTechTips' }],
  ])('%s', (input, expected) => {
    expect(parseChannelInput(input)).toEqual(expected)
  })

  it.each([
    'linus tech tips',
    'mkbhd',
    '@ab', // too short for a handle
    'UCshort',
    'https://example.com/@mkbhd',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/@mkbhd',
  ])('treats "%s" as a search query', (input) => {
    expect(parseChannelInput(input)).toEqual({ kind: 'query', value: input.trim() })
  })
})

describe('resolveChannel', () => {
  function setup(found: boolean) {
    const f = fakeFetch(() => ({ body: { items: found ? [rawChannel(ID)] : [] } }))
    const client = createYouTubeClient({ fetch: f.fetch, getAccessToken: async () => 't' })
    const lastParams = () => Object.fromEntries(f.requests.at(-1)!.url.searchParams)
    return { client, requests: f.requests, lastParams }
  }

  it.each([
    [ID, { id: ID }],
    ['https://youtube.com/@mkbhd', { forHandle: '@mkbhd' }],
    ['https://youtube.com/user/oldname', { forUsername: 'oldname' }],
    ['https://youtube.com/c/Custom', { forHandle: '@Custom' }],
  ])('looks up %s with %o', async (input, params) => {
    const { client, lastParams } = setup(true)
    const channel = await resolveChannel(client, input)
    expect(channel?.id).toBe(ID)
    expect(lastParams()).toMatchObject(params)
  })

  it('returns null when the channel does not exist', async () => {
    const { client } = setup(false)
    expect(await resolveChannel(client, '@doesnotexist123')).toBeNull()
  })

  it('makes no request for plain search text', async () => {
    const { client, requests } = setup(true)
    expect(await resolveChannel(client, 'linus tech tips')).toBeNull()
    expect(requests).toHaveLength(0)
  })
})
