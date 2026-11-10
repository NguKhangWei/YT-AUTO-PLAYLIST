// The tray menu and its hover text.
import type { MenuItemConstructorOptions } from 'electron'
import { formatInZone } from '../shared/format'
import type { SchedulerRecord } from './db/sqlite-storage'

export interface TrayState {
  paused: boolean
  openAtLogin: boolean
  canOpenAtLogin: boolean // only the installed app, not `npm run dev`
}

export interface TrayActions {
  open: () => void
  setPaused: (paused: boolean) => void
  setOpenAtLogin: (enabled: boolean) => void
  quit: () => void
}

export function trayMenu(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Open auto-yt', click: actions.open },
    { type: 'separator' },
    {
      label: 'Pause scheduled scans',
      type: 'checkbox',
      checked: state.paused,
      click: () => actions.setPaused(!state.paused),
    },
    {
      label: state.canOpenAtLogin ? 'Start at login' : 'Start at login (installed app only)',
      type: 'checkbox',
      checked: state.openAtLogin,
      enabled: state.canOpenAtLogin,
      click: () => actions.setOpenAtLogin(!state.openAtLogin),
    },
    { type: 'separator' },
    { label: 'Quit auto-yt', click: actions.quit },
  ]
}

/** E.g. "auto-yt · next scan: Gaming, Wed 11 Nov, 09:00". */
export function trayTooltip(schedulers: SchedulerRecord[], paused: boolean): string {
  if (paused) return 'auto-yt · scheduled scans paused'
  const next = schedulers
    .filter((s) => s.active)
    .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime())[0]
  if (!next) return 'auto-yt · no active schedulers'
  const text = `auto-yt · next scan: ${next.name}, ${formatInZone(next.nextRunAt, next.timezone)}`
  return text.slice(0, 127) // Windows' tooltip limit
}
