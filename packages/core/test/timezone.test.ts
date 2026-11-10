import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMEZONE, isValidTimeZone } from '../src'

describe('timezone', () => {
  it('defaults to Malaysia Time', () => {
    expect(DEFAULT_TIMEZONE).toBe('Asia/Kuala_Lumpur')
    expect(isValidTimeZone(DEFAULT_TIMEZONE)).toBe(true)
  })

  it('accepts IANA zones', () => {
    expect(isValidTimeZone('America/Denver')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
  })

  it('rejects unknown or empty zones', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone('   ')).toBe(false)
  })
})
