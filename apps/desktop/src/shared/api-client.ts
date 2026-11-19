// Builds the window's `Api` from two transports: calls and pushes (Electron IPC or HTTP + SSE).
import type { Api, IpcResult } from './api'
import { IPC } from './ipc'

/** Sends a call; the transport resolves with main's envelope. */
export type CallTransport = (channel: string, args: unknown[]) => Promise<IpcResult<unknown>>
/** Subscribes to a push; returns the unsubscribe function. */
export type PushTransport = (channel: string, listener: (value: never) => void) => () => void

export function buildApi(send: CallTransport, on: PushTransport): Api {
  /** A function that calls `channel` and throws main's error message on failure. */
  const call =
    (channel: string) =>
    async (...args: unknown[]): Promise<never> => {
      const result = await send(channel, args)
      if (!result.ok) throw new Error(result.error)
      return result.data as never
    }

  return {
    auth: {
      getStatus: call(IPC.authGetStatus),
      signIn: call(IPC.authSignIn),
      cancelSignIn: call(IPC.authCancelSignIn),
      signOut: call(IPC.authSignOut),
      onStatusChange: (listener) => on(IPC.authStatusChanged, listener),
    },
    youtube: { listMyPlaylists: call(IPC.listMyPlaylists) },
    channels: { search: call(IPC.searchChannels) },
    schedulers: {
      list: call(IPC.schedulersList),
      create: call(IPC.schedulersCreate),
      update: call(IPC.schedulersUpdate),
      setActive: call(IPC.schedulersSetActive),
      remove: call(IPC.schedulersRemove),
      runNow: call(IPC.schedulersRunNow),
    },
    runs: {
      list: call(IPC.runsList),
      onChange: (listener) => on(IPC.runsChanged, listener),
    },
    scans: {
      isPaused: call(IPC.scansIsPaused),
      setPaused: call(IPC.scansSetPaused),
      onPausedChange: (listener) => on(IPC.scansPausedChanged, listener),
    },
  }
}
