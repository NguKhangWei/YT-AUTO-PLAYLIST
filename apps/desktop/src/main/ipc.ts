import { createYouTubeClient, YouTubeApiError, type YouTubeClient } from '@auto-yt/core'
import type { BrowserWindow, IpcMain } from 'electron'
import type { ApiErrorInfo, AuthStatus, IpcResult, SchedulerInput } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { GoogleAuth } from './auth/google-auth'
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
  schedulers: SchedulerService
  getWindows: () => BrowserWindow[]
}): void {
  const { ipcMain, auth, schedulers } = deps
  const youtube = createYouTubeClient({ getAccessToken: auth.getAccessToken })

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

  ipcMain.handle(IPC.schedulersList, wrap(schedulers.list))
  ipcMain.handle(
    IPC.schedulersCreate,
    wrap((input: SchedulerInput) => schedulers.create(input)),
  )
  ipcMain.handle(
    IPC.schedulersUpdate,
    wrap((id: string, input: SchedulerInput) => schedulers.update(id, input)),
  )
  ipcMain.handle(
    IPC.schedulersSetActive,
    wrap((id: string, active: boolean) => schedulers.setActive(id, active)),
  )
  ipcMain.handle(
    IPC.schedulersRemove,
    wrap((id: string) => schedulers.remove(id)),
  )

  auth.onStatusChange((status: AuthStatus) => {
    for (const win of deps.getWindows()) win.webContents.send(IPC.authStatusChanged, status)
  })
}
