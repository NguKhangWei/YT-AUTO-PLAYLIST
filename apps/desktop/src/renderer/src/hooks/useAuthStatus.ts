import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus } from '../../../shared/api'
import { useApi } from '@/lib/api'

/** Current auth status, kept in sync with main-process changes. */
export function useAuthStatus() {
  const api = useApi()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.auth
      .getStatus()
      .then((s) => alive && setStatus(s))
      .catch((e: Error) => alive && setError(e.message))
    const off = api.auth.onStatusChange((s) => alive && setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [api])

  const update = useCallback((s: AuthStatus) => setStatus(s), [])
  return { status, error, update }
}
