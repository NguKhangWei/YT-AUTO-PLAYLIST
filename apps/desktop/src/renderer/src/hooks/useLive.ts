// Loads a value from main and keeps it current when main pushes a change.
import { useCallback, useEffect, useState } from 'react'
import type { Api } from '../../../shared/api'
import { useApi } from '@/lib/api'

export type Load<T> = (api: Api) => Promise<T>
/** Calls `onChange` with the new value, or with nothing to mean "reload". */
export type Subscribe<T> = (api: Api, onChange: (value?: T) => void) => () => void

/**
 * Loads with `load` and re-loads or updates on `subscribe`. Pass functions
 * defined outside the component, so the subscription isn't recreated on render.
 */
export function useLive<T>(load: Load<T>, subscribe?: Subscribe<T>) {
  const api = useApi()
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(
    () =>
      load(api).then(
        (v) => {
          setValue(v)
          setError(null)
        },
        (e: Error) => setError(e.message),
      ),
    [api, load],
  )

  useEffect(() => {
    void reload()
    return subscribe?.(api, (v) => (v === undefined ? void reload() : setValue(v)))
  }, [api, reload, subscribe])

  return { value, setValue, error, reload }
}
