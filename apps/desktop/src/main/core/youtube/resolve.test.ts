import { describe, expect, it } from 'vitest'
import { channelLookup } from './resolve'

const ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw'

describe('channelLookup', () => {
  it.each([
    [ID, { ids: [ID] }],
    [`  ${ID}  `, { ids: [ID] }],
    ['@mkbhd', { forHandle: '@mkbhd' }],
    ['@some.name-1_x', { forHandle: '@some.name-1_x' }],
    ['@日本語チャンネル', { forHandle: '@日本語チャンネル' }],
    [`https://www.youtube.com/channel/${ID}`, { ids: [ID] }],
    [`youtube.com/channel/${ID}/videos`, { ids: [ID] }],
    ['https://youtube.com/@mkbhd', { forHandle: '@mkbhd' }],
    ['https://m.youtube.com/@mkbhd/featured?si=abc', { forHandle: '@mkbhd' }],
    ['www.youtube.com/@mkbhd', { forHandle: '@mkbhd' }],
    ['https://www.youtube.com/%40mkbhd', { forHandle: '@mkbhd' }],
    ['https://www.youtube.com/user/GoogleDevelopers', { forUsername: 'GoogleDevelopers' }],
    ['https://www.youtube.com/c/LinusTechTips', { forHandle: '@LinusTechTips' }],
  ])('%s', (input, expected) => {
    expect(channelLookup(input)).toEqual(expected)
  })

  it.each([
    'linus tech tips',
    'mkbhd',
    '@ab', // too short for a handle
    'UCshort',
    'https://example.com/@mkbhd',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/@mkbhd',
  ])('treats "%s" as search text', (input) => {
    expect(channelLookup(input)).toBeNull()
  })
})
