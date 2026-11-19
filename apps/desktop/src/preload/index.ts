// Exposes the main-process API to the window as `window.api`.
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult } from '../shared/api'
import { buildApi } from '../shared/api-client'

const api = buildApi(
  async (channel, args) => (await ipcRenderer.invoke(channel, ...args)) as IpcResult<unknown>,
  (channel, listener) => {
    const handler = (_e: unknown, value: unknown) => listener(value as never)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
)

contextBridge.exposeInMainWorld('api', api)
