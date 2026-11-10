import { YouTubeApiError, type YouTubeClient } from '@auto-yt/core'
import type { BrowserWindow, IpcMain } from 'electron'
import type { ApiErrorInfo, AuthStatus, IpcResult, SchedulerInput } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { GoogleAuth } from './auth/google-auth'
import type { ChannelService } from './channels'
import type { QuotaTracker } from './quota'
import type { Runner } from './runner'
import type { SchedulerLoop } from './scheduler-loop'
import type { SqliteStorage } from './db/sqlite-storage'
import type { SchedulerService } from './schedulers'

export function toErrorInfo(e: unknown): ApiErrorInfo {
  if (e instanceof YouTubeApiError) return { kind: e.kind, message: e.message }
  if (e instanceof Error) {
    const kind = (e as { kind?: unknown }).kind
    return { kind: typeof kind === 'string' ? kind : 'error', message: e.message }
  }
  return { kind: 'error', message: String(e) }
}

/**
 * The user's playlists. YouTube answers 404 "Channel not found" when the
 * signed-in account has no YouTube channel; explain that instead.
 */
export async function listMyPlaylists(youtube: Pick<YouTubeClient, 'listMyPlaylists'>) {
  try {
    return await youtube.listMyPlaylists()
  } catch (e) {
    if (e instanceof YouTubeApiError && e.kind === 'notFound') {
      throw new YouTubeApiError(
        'noChannel',
        'This Google account has no YouTube channel, so it has no playlists. Create a channel at youtube.com (or sign in with another account), then try again.',
        e.status,
        e.reason,
      )
    }
    throw e
  }
}

/** Wrap a handler so it always resolves to an `IpcResult` envelope. */
export function wrap<A extends unknown[], T>(fn: (...args: A) => Promise<T> | T) {
  return async (_event: unknown, ...args: A): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) }
    }
  }
}

export function registerIpc(deps: {
  ipcMain: IpcMain
  auth: GoogleAuth
  youtube: YouTubeClient
  schedulers: SchedulerService
  channels: ChannelService
  quota: QuotaTracker
  runner: Runner
  storage: SqliteStorage
  loop: Pick<SchedulerLoop, 'isPaused' | 'setPaused'>
  /** A scheduler was created, edited, toggled or deleted (re-plan the next scan). */
  onSchedulersChanged?: () => void
  /** Registers development-only handlers (debug lookback). */
  isDev: boolean
  now: () => Date
  getWindows: () => BrowserWindow[]
}): void {
  const { ipcMain, auth, youtube, schedulers, channels, quota, runner, storage, loop } = deps
  /** Run a scheduler mutation, then tell the loop. */
  const changed =
    <A extends unknown[], T>(fn: (...args: A) => Promise<T>) =>
    async (...args: A): Promise<T> => {
      const result = await fn(...args)
      deps.onSchedulersChanged?.()
      return result
    }

  ipcMain.handle(IPC.authGetStatus, wrap(auth.status))
  ipcMain.handle(IPC.authSignIn, wrap(auth.signIn))
  ipcMain.handle(
    IPC.authCancelSignIn,
    wrap(async () => auth.cancelSignIn()),
  )
  ipcMain.handle(IPC.authSignOut, wrap(auth.signOut))
  ipcMain.handle(
    IPC.youtubeListMyPlaylists,
    wrap(() => listMyPlaylists(youtube)),
  )

  ipcMain.handle(
    IPC.channelsSearch,
    wrap((query: string) => channels.search(String(query ?? ''))),
  )
  ipcMain.handle(IPC.quotaGet, wrap(quota.status))

  ipcMain.handle(IPC.schedulersList, wrap(schedulers.list))
  ipcMain.handle(
    IPC.schedulersCreate,
    wrap(changed((input: SchedulerInput) => schedulers.create(input))),
  )
  ipcMain.handle(
    IPC.schedulersUpdate,
    wrap(changed((id: string, input: SchedulerInput) => schedulers.update(id, input))),
  )
  ipcMain.handle(
    IPC.schedulersSetActive,
    wrap(changed((id: string, active: boolean) => schedulers.setActive(id, active))),
  )
  ipcMain.handle(IPC.schedulersRemove, wrap(changed((id: string) => schedulers.remove(id))))

  ipcMain.handle(
    IPC.schedulersRunNow,
    wrap((id: string) => runner.run(String(id), 'manual')),
  )
  ipcMain.handle(
    IPC.runsList,
    wrap((opts?: { schedulerId?: string; limit?: number }) =>
      storage.listRuns({
        schedulerId: typeof opts?.schedulerId === 'string' ? opts.schedulerId : undefined,
        limit: Math.min(500, Math.max(1, Number(opts?.limit) || 100)),
      }),
    ),
  )
  ipcMain.handle(
    IPC.debugLookback,
    wrap((id: string, days: number) => {
      if (!deps.isDev) throw new Error('Debug lookback is only available in development.')
      const d = Math.min(30, Math.max(1, Math.floor(Number(days) || 7)))
      storage.debugLookback(String(id), new Date(deps.now().getTime() - d * 86_400_000))
    }),
  )

  ipcMain.handle(
    IPC.appGetState,
    wrap(() => ({ paused: loop.isPaused() })),
  )
  ipcMain.handle(
    IPC.appSetPaused,
    wrap((paused: boolean) => {
      loop.setPaused(paused === true)
      return { paused: loop.isPaused() }
    }),
  )

  auth.onStatusChange((status: AuthStatus) => {
    for (const win of deps.getWindows()) win.webContents.send(IPC.authStatusChanged, status)
  })
}
