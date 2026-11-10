import { describe, expect, it, vi } from 'vitest'
import { scheduler } from './test/fixtures'
import { trayMenu, trayTooltip } from './tray'

const actions = () => ({
  open: vi.fn(),
  setPaused: vi.fn(),
  setOpenAtLogin: vi.fn(),
  quit: vi.fn(),
})

describe('trayMenu', () => {
  it('offers open, pause, start at login and quit', () => {
    const a = actions()
    const menu = trayMenu({ paused: false, openAtLogin: true, canOpenAtLogin: true }, a)
    expect(menu.filter((m) => m.label).map((m) => [m.label, m.checked])).toEqual([
      ['Open auto-yt', undefined],
      ['Pause scheduled scans', false],
      ['Start at login', true],
      ['Quit auto-yt', undefined],
    ])
    const click = (label: string) => (menu.find((m) => m.label === label)!.click as () => void)()
    click('Open auto-yt')
    click('Pause scheduled scans')
    click('Start at login')
    click('Quit auto-yt')
    expect(a.open).toHaveBeenCalled()
    expect(a.setPaused).toHaveBeenCalledWith(true)
    expect(a.setOpenAtLogin).toHaveBeenCalledWith(false)
    expect(a.quit).toHaveBeenCalled()
  })

  it('disables start at login outside the installed app', () => {
    const menu = trayMenu({ paused: true, openAtLogin: false, canOpenAtLogin: false }, actions())
    const item = menu.find((m) => m.label?.startsWith('Start at login'))!
    expect(item).toMatchObject({ label: 'Start at login (installed app only)', enabled: false })
    expect(menu.find((m) => m.label === 'Pause scheduled scans')?.checked).toBe(true)
  })
})

describe('trayTooltip', () => {
  it('names the next active scan in its own time zone', () => {
    const tip = trayTooltip(
      [
        scheduler('a', { name: 'Later', nextRunAt: new Date('2026-11-12T01:00:00Z') }),
        scheduler('b', { name: 'Off', active: false, nextRunAt: new Date(0) }),
        scheduler('c', { name: 'Gaming', nextRunAt: new Date('2026-11-11T01:00:00Z') }),
      ],
      false,
    )
    expect(tip).toBe('auto-yt · next scan: Gaming, Wed 11 Nov, 09:00')
  })

  it('says when paused or when nothing is active', () => {
    expect(trayTooltip([], true)).toBe('auto-yt · scheduled scans paused')
    expect(trayTooltip([], false)).toBe('auto-yt · no active schedulers')
  })

  it('stays within the Windows tooltip limit', () => {
    const long = scheduler('a', { name: 'x'.repeat(200) })
    expect(trayTooltip([long], false).length).toBeLessThanOrEqual(127)
  })
})
