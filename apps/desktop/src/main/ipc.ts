// Connects the window's API calls to the main-process services.
import type { IpcMain } from 'electron'
import type { IpcResult, SchedulerInput } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { GoogleAuth } from './auth/google-auth'
import type { ChannelService } from './channels'
import type { YouTubeClient } from './core/youtube/client'
import { YouTubeApiError } from './core/youtube/errors'
import type { SqliteStorage } from './db/sqlite-storage'
import type { Runner } from './runner'
import type { SchedulerLoop } from './scheduler-loop'
import type { SchedulerService } from './schedulers'

/** The user's playlists, explaining YouTube's 404 for accounts without a channel. */
export async function listMyPlaylists(youtube: Pick<YouTubeClient, 'listMyPlaylists'>) {
  try {
    return await youtube.listMyPlaylists()
  } catch (e) {
    if (!(e instanceof YouTubeApiError && e.kind === 'notFound')) throw e
    throw new Error(
      'This Google account has no YouTube channel, so it has no playlists. Create a channel at youtube.com (or sign in with another account), then try again.',
      { cause: e },
    )
  }
}

/** Wraps a handler so its result or error message reaches the window intact. */
export function wrap<A extends unknown[], T>(fn: (...args: A) => Promise<T> | T) {
  return async (_event: unknown, ...args: A): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

export function registerIpc(deps: {
  ipcMain: IpcMain
  auth: GoogleAuth
  youtube: YouTubeClient
  schedulers: SchedulerService
  channels: ChannelService
  runner: Runner
  storage: SqliteStorage
  loop: Pick<SchedulerLoop, 'isPaused' | 'setPaused'>
}): void {
  const { auth, schedulers, loop } = deps
  const handle = <A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) =>
    deps.ipcMain.handle(channel, wrap(fn))

  handle(IPC.authGetStatus, auth.status)
  handle(IPC.authSignIn, auth.signIn)
  handle(IPC.authCancelSignIn, auth.cancelSignIn)
  handle(IPC.authSignOut, auth.signOut)
  handle(IPC.listMyPlaylists, () => listMyPlaylists(deps.youtube))
  handle(IPC.searchChannels, (query: string) => deps.channels.search(query))

  handle(IPC.schedulersList, schedulers.list)
  handle(IPC.schedulersCreate, (input: SchedulerInput) => schedulers.create(input))
  handle(IPC.schedulersUpdate, (id: string, input: SchedulerInput) => schedulers.update(id, input))
  handle(IPC.schedulersSetActive, (id: string, active: boolean) => schedulers.setActive(id, active))
  handle(IPC.schedulersRemove, (id: string) => schedulers.remove(id))
  handle(IPC.schedulersRunNow, (id: string) => deps.runner.run(id, 'manual'))
  handle(IPC.runsList, () => deps.storage.listRuns({ limit: 100 }))

  handle(IPC.scansIsPaused, loop.isPaused)
  handle(IPC.scansSetPaused, (paused: boolean) => {
    loop.setPaused(paused)
    return loop.isPaused()
  })
}
