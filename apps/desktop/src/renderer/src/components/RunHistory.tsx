// History tab: recent scans of all schedulers, newest first.
import type { Api } from '../../../shared/api'
import { RunDetailsList, StatusBadge } from '@/components/RunSummary'
import { useLive } from '@/hooks/useLive'
import { formatLocal } from '@/lib/format'
import { runHeadline } from '@/lib/runs'

const loadRuns = (api: Api) => api.runs.list()
const watchRuns = (api: Api, reload: () => void) => api.runs.onChange(() => reload())

export function RunHistory() {
  const { value: runs, error } = useLive(loadRuns, watchRuns)

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
