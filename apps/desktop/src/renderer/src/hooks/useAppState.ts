import { useCallback, useEffect, useState } from 'react'
import type { AppState } from '../../../shared/api'
import { useApi } from '@/lib/api'

/** App-wide state (paused), kept in sync with changes made from the tray. */
export function useAppState() {
  const api = useApi()
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    let alive = true
    api.app.getState().then(
      (s) => alive && setState(s),
      () => undefined,
    )
    const off = api.app.onStateChange((s) => alive && setState(s))
    return () => {
      alive = false
      off()
    }
  }, [api])

  const setPaused = useCallback(
    async (paused: boolean) => setState(await api.app.setPaused(paused)),
    [api],
  )
  return { state, setPaused }
}
