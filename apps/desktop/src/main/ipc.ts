// Connects the window's API calls to the main-process services (Electron IPC or the web server).
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arguments come from the window as JSON
export type Handler = (...args: any[]) => unknown
export type Handlers = Record<string, Handler>

export interface HandlerDeps {
  auth: Pick<GoogleAuth, 'status' | 'signIn' | 'cancelSignIn' | 'signOut'>
  youtube: YouTubeClient
  schedulers: SchedulerService
  channels: ChannelService
  runner: Runner
  storage: SqliteStorage
  loop: Pick<SchedulerLoop, 'isPaused' | 'setPaused'>
}

/** Every call the window can make, by channel name; shared by Electron IPC and the web server. */
export function createHandlers(deps: HandlerDeps): Handlers {
  const { auth, schedulers, loop } = deps
  return {
    [IPC.authGetStatus]: () => auth.status(),
    [IPC.authSignIn]: () => auth.signIn(),
    [IPC.authCancelSignIn]: () => auth.cancelSignIn(),
    [IPC.authSignOut]: () => auth.signOut(),
    [IPC.listMyPlaylists]: () => listMyPlaylists(deps.youtube),
    [IPC.searchChannels]: (query: string) => deps.channels.search(query),

    [IPC.schedulersList]: () => schedulers.list(),
    [IPC.schedulersCreate]: (input: SchedulerInput) => schedulers.create(input),
    [IPC.schedulersUpdate]: (id: string, input: SchedulerInput) => schedulers.update(id, input),
    [IPC.schedulersSetActive]: (id: string, active: boolean) => schedulers.setActive(id, active),
    [IPC.schedulersRemove]: (id: string) => schedulers.remove(id),
    [IPC.schedulersRunNow]: (id: string) => deps.runner.run(id, 'manual'),
    [IPC.runsList]: () => deps.storage.listRuns({ limit: 100 }),

    [IPC.scansIsPaused]: () => loop.isPaused(),
    [IPC.scansSetPaused]: (paused: boolean) => {
      loop.setPaused(paused)
      return loop.isPaused()
    },
  }
}

/** Registers every handler with Electron's IPC. */
export function registerIpc(ipcMain: Pick<IpcMain, 'handle'>, handlers: Handlers): void {
  for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, wrap(fn))
}
