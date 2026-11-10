import { useEffect, useState } from 'react'
import type { RunView } from '../../../shared/api'
import { RunDetailsList, StatusBadge } from '@/components/RunSummary'
import { useApi } from '@/lib/api'
import { formatLocal } from '@/lib/format'
import { runHeadline } from '@/lib/runs'

/** Recent scans of all schedulers, newest first; refreshes when a scan starts or ends. */
export function RunHistory() {
  const api = useApi()
  const [runs, setRuns] = useState<RunView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      api.runs.list({ limit: 100 }).then(
        (r) => alive && setRuns(r),
        (e: Error) => alive && setError(e.message),
      )
    void load()
    const off = api.runs.onChange(() => void load())
    return () => {
      alive = false
      off()
    }
  }, [api])

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  }
  if (!runs) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (runs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No scans yet. Use Run now on a scheduler, or wait for its next scan.
      </p>
    )
  }

  return (
    <ul aria-label="Scan history" className="grid gap-2">
      {runs.map((r) => (
        <li key={r.id} className="rounded-lg border">
          <details>
            <summary className="flex cursor-pointer items-center gap-3 p-3 text-sm">
              <StatusBadge status={r.status} />
              <span className="font-medium">{r.schedulerName}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {runHeadline(r)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {r.trigger === 'manual' ? 'Manual · ' : ''}
                {formatLocal(r.startedAt)}
              </span>
            </summary>
            <div className="border-t p-3">
              <RunDetailsList run={r} />
              {!r.details && r.error && <p className="text-sm">{r.error.message}</p>}
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}
