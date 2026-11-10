import { contextBridge } from 'electron'
import type { Api } from '../shared/api'

// Typed IPC calls are added in M5/M6. For now, expose runtime versions only.
const api: Api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
}

contextBridge.exposeInMainWorld('api', api)
