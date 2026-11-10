// Exposes the main-process API to the window as `window.api`.
import { contextBridge, ipcRenderer } from 'electron'
import type { Api, IpcResult } from '../shared/api'
import { IPC } from '../shared/ipc'

/** A function that invokes `channel` and throws main's error message on failure. */
function call(channel: string) {
  return async (...args: unknown[]) => {
    const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<never>
    if (!result.ok) throw new Error(result.error)
    return result.data
  }
}

/** Subscribes to a push from main; returns the unsubscribe function. */
function on<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: Api = {
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

contextBridge.exposeInMainWorld('api', api)
