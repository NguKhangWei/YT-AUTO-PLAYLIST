import { contextBridge, ipcRenderer } from 'electron'
import type { AuthStatus, Bridge } from '../shared/api'
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
  schedulers: {
    list: invoke(IPC.schedulersList),
    create: invoke(IPC.schedulersCreate),
    update: invoke(IPC.schedulersUpdate),
    setActive: invoke(IPC.schedulersSetActive),
    remove: invoke(IPC.schedulersRemove),
  },
}

contextBridge.exposeInMainWorld('bridge', bridge)
