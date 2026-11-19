import { describe, expect, it } from 'vitest'
import { browserCommand } from './signin'

describe('browserCommand', () => {
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?a=1&b=2'

  it('passes the URL as one argument, never through a shell (it contains &)', () => {
    expect(browserCommand('win32', url)).toEqual(['rundll32', ['url.dll,FileProtocolHandler', url]])
    expect(browserCommand('darwin', url)).toEqual(['open', [url]])
    expect(browserCommand('linux', url)).toEqual(['xdg-open', [url]])
  })
})
