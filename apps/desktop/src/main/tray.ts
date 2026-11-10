import type { SchedulerRecord } from '@auto-yt/core'
import type { MenuItemConstructorOptions } from 'electron'

export interface TrayState {
  paused: boolean
  openAtLogin: boolean
  /** Start-at-login only works for the installed app, not `npm run dev`. */
  canOpenAtLogin: boolean
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

/** Hover text, e.g. "auto-yt · next scan: Gaming, Wed 11 Nov, 09:00". */
export function trayTooltip(schedulers: SchedulerRecord[], paused: boolean): string {
  if (paused) return 'auto-yt · scheduled scans paused'
  const next = schedulers
    .filter((s) => s.active)
    .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime())[0]
  if (!next) return 'auto-yt · no active schedulers'
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: next.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(next.nextRunAt)
  // Windows truncates tray tooltips at 127 characters.
  return `auto-yt · next scan: ${next.name}, ${when}`.slice(0, 127)
}
