import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, AuthStatus, Bridge, QuotaStatus } from '../shared/api'
import { IPC } from '../shared/ipc'

// Results pass through as `IpcResult` envelopes; the renderer unwraps them
// (errors thrown here would lose their `kind` crossing the contextBridge).
const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const bridge: Bridge = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  auth: {
    getStatus: invoke(IPC.authGetStatus),
    signIn: invoke(IPC.authSignIn),
    cancelSignIn: invoke(IPC.authCancelSignIn),
    signOut: invoke(IPC.authSignOut),
    onStatusChange(listener) {
      const handler = (_e: unknown, status: AuthStatus) => listener(status)
      ipcRenderer.on(IPC.authStatusChanged, handler)
      return () => ipcRenderer.removeListener(IPC.authStatusChanged, handler)
    },
  },
  youtube: {
    listMyPlaylists: invoke(IPC.youtubeListMyPlaylists),
  },
  channels: {
    search: invoke(IPC.channelsSearch),
  },
  quota: {
    get: invoke(IPC.quotaGet),
    onChange(listener) {
      const handler = (_e: unknown, status: QuotaStatus) => listener(status)
      ipcRenderer.on(IPC.quotaChanged, handler)
      return () => ipcRenderer.removeListener(IPC.quotaChanged, handler)
    },
  },
  schedulers: {
    list: invoke(IPC.schedulersList),
    create: invoke(IPC.schedulersCreate),
    update: invoke(IPC.schedulersUpdate),
    setActive: invoke(IPC.schedulersSetActive),
    remove: invoke(IPC.schedulersRemove),
    runNow: invoke(IPC.schedulersRunNow),
  },
  runs: {
    list: invoke(IPC.runsList),
    onChange(listener) {
      const handler = () => listener()
      ipcRenderer.on(IPC.runsChanged, handler)
      return () => ipcRenderer.removeListener(IPC.runsChanged, handler)
    },
  },
  debug: {
    lookback: invoke(IPC.debugLookback),
  },
  app: {
    getState: invoke(IPC.appGetState),
    setPaused: invoke(IPC.appSetPaused),
    onStateChange(listener) {
      const handler = (_e: unknown, state: AppState) => listener(state)
      ipcRenderer.on(IPC.appStateChanged, handler)
      return () => ipcRenderer.removeListener(IPC.appStateChanged, handler)
    },
  },
}

contextBridge.exposeInMainWorld('bridge', bridge)
