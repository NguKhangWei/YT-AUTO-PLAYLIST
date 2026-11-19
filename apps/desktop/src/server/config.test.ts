import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const vm = {
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  AUTO_YT_DATA_DIR: '/var/lib/auto-yt',
  AUTO_YT_ALLOWED_LOGIN: 'me@gmail.com',
  NTFY_TOPIC: 'auto-yt-0123456789abcdef',
}

describe('loadConfig', () => {
  it('reads the VM settings, with defaults for the port and Shorts probe', () => {
    expect(loadConfig(vm)).toEqual({
      clientId: 'id.apps.googleusercontent.com',
      clientSecret: 'secret',
      dataDir: '/var/lib/auto-yt',
      port: 8080,
      allowedLogin: 'me@gmail.com',
      ntfyTopic: 'auto-yt-0123456789abcdef',
      shortsProbe: true,
    })
    expect(loadConfig({ ...vm, SHORTS_PROBE: 'OFF', AUTO_YT_PORT: '9000' })).toMatchObject({
      shortsProbe: false,
      port: 9000,
    })
  })

  it('accepts the desktop .env names for the Google client', () => {
    const { GOOGLE_CLIENT_ID: _a, GOOGLE_CLIENT_SECRET: _b, ...rest } = vm
    const c = loadConfig({
      ...rest,
      MAIN_VITE_GOOGLE_CLIENT_ID: 'x',
      MAIN_VITE_GOOGLE_CLIENT_SECRET: 'y',
    })
    expect(c).toMatchObject({ clientId: 'x', clientSecret: 'y' })
  })

  it('lists every problem at once', () => {
    const message = (() => {
      try {
        loadConfig({ AUTO_YT_PORT: 'abc', SHORTS_PROBE: 'maybe', NTFY_TOPIC: 'auto-yt' })
      } catch (e) {
        return (e as Error).message
      }
    })()
    for (const part of [
      'GOOGLE_CLIENT_ID',
      'AUTO_YT_DATA_DIR',
      'AUTO_YT_PORT',
      'AUTO_YT_ALLOWED_LOGIN',
      'NTFY_TOPIC',
      'SHORTS_PROBE',
    ]) {
      expect(message).toContain(part)
    }
  })

  it('rejects a short, guessable ntfy topic', () => {
    expect(() => loadConfig({ ...vm, NTFY_TOPIC: 'auto-yt' })).toThrow(/at least 16/)
    expect(() => loadConfig({ ...vm, NTFY_TOPIC: 'has spaces in it ok?' })).toThrow(/NTFY_TOPIC/)
  })

  it('without a topic, sends no pushes', () => {
    const { NTFY_TOPIC: _t, ...rest } = vm
    expect(loadConfig(rest).ntfyTopic).toBeUndefined()
  })

  it('local mode uses a separate data folder and lets anyone on this PC in', () => {
    const c = loadConfig({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }, { local: true })
    expect(c.dataDir).toBe(resolve('.local-server'))
    expect(c.allowedLogin).toBe('*')
  })
})
