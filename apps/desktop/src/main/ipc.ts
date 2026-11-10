import { createYouTubeClient, YouTubeApiError } from '@auto-yt/core'
import type { BrowserWindow, IpcMain } from 'electron'
import type { ApiErrorInfo, AuthStatus, IpcResult } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { GoogleAuth } from './auth/google-auth'

export function toErrorInfo(e: unknown): ApiErrorInfo {
  if (e instanceof YouTubeApiError) return { kind: e.kind, message: e.message }
  if (e instanceof Error) return { kind: 'error', message: e.message }
  return { kind: 'error', message: String(e) }
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
  getWindows: () => BrowserWindow[]
}): void {
  const { ipcMain, auth } = deps
  const youtube = createYouTubeClient({ getAccessToken: auth.getAccessToken })

  ipcMain.handle(IPC.authGetStatus, wrap(auth.status))
  ipcMain.handle(IPC.authSignIn, wrap(auth.signIn))
  ipcMain.handle(
    IPC.authCancelSignIn,
    wrap(async () => auth.cancelSignIn()),
  )
  ipcMain.handle(IPC.authSignOut, wrap(auth.signOut))
  ipcMain.handle(IPC.youtubeListMyPlaylists, wrap(youtube.listMyPlaylists))

  auth.onStatusChange((status: AuthStatus) => {
    for (const win of deps.getWindows()) win.webContents.send(IPC.authStatusChanged, status)
  })
}
