import { createContext, useContext } from 'react'
import type { Api, Bridge, IpcResult } from '../../../shared/api'

/** A failed `Api` call, with a machine-readable kind (e.g. "quotaExceeded", "unauthorized"). */
export class ApiError extends Error {
  override readonly name = 'ApiError'
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message)
  }
}

async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const result = await p
  if (!result.ok) throw new ApiError(result.error.kind, result.error.message)
  return result.data
}

/** Build the renderer API from the preload bridge, turning error envelopes into `ApiError`s. */
export function createApi(bridge: Bridge): Api {
  return {
    versions: bridge.versions,
    auth: {
      getStatus: () => unwrap(bridge.auth.getStatus()),
      signIn: () => unwrap(bridge.auth.signIn()),
      cancelSignIn: () => unwrap(bridge.auth.cancelSignIn()),
      signOut: () => unwrap(bridge.auth.signOut()),
      onStatusChange: (listener) => bridge.auth.onStatusChange(listener),
    },
    youtube: {
      listMyPlaylists: () => unwrap(bridge.youtube.listMyPlaylists()),
    },
  }
}

export const ApiContext = createContext<Api | null>(null)

export function useApi(): Api {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi() needs an <ApiContext.Provider>')
  return api
}
