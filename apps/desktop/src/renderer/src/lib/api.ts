// Gives components the preload API through context, so tests can supply a fake.
import { createContext, useContext } from 'react'
import type { Api } from '../../../shared/api'

export const ApiContext = createContext<Api | null>(null)

export function useApi(): Api {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi() needs an <ApiContext.Provider>')
  return api
}
