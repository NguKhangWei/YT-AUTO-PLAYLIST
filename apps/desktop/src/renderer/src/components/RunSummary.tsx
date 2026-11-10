import type { RunSkipReason, RunView } from '../../../shared/api'
import { formatRelative } from '@/lib/format'
import { runHeadline } from '@/lib/runs'
import { cn } from '@/lib/utils'

const SKIP_LABELS: Record<RunSkipReason, string> = {
  short: 'Shorts',
  livestream: 'livestreams/premieres',
  live: 'live now',
  upcoming: 'upcoming',
  inPlaylist: 'already in playlist',
  unavailable: 'unavailable',
}

export function StatusBadge({ status }: { status: RunView['status'] }) {
  const label = { running: 'Running', ok: 'OK', partial: 'Partial', error: 'Failed' }[status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'ok' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        status === 'partial' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        status === 'error' && 'bg-destructive/15 text-destructive',
        status === 'running' && 'bg-primary/10 text-foreground',
      )}
    >
      {label}
    </span>
  )
}

/** Added videos (linked), skipped counts by reason and unreadable channels. */
export function RunDetailsList({ run }: { run: RunView }) {
  const d = run.details
  if (!d) return null
  const skippedByReason = new Map<RunSkipReason, number>()
  for (const s of d.skipped) skippedByReason.set(s.reason, (skippedByReason.get(s.reason) ?? 0) + 1)

  return (
    <div className="grid gap-2 text-sm">
      {d.added.length > 0 && (
        <ol className="list-decimal space-y-0.5 pl-5">
          {d.added.map((v) => (
            <li key={v.id}>
              <a
                href={`https://www.youtube.com/watch?v=${v.id}`}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {v.title}
              </a>
            </li>
          ))}
        </ol>
      )}
      {skippedByReason.size > 0 && (
        <p className="text-muted-foreground">
          Skipped:{' '}
          {[...skippedByReason].map(([reason, n]) => `${n} ${SKIP_LABELS[reason]}`).join(', ')}
        </p>
      )}
      {d.unavailableChannels.length > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          Couldn&apos;t read: {d.unavailableChannels.map((c) => c.title).join(', ')} (deleted
          channel?)
        </p>
      )}
      {d.quotaWarning && (
        <p className="text-amber-700 dark:text-amber-400">
          The app&apos;s quota estimate was low before adding videos.
        </p>
      )}
      {d.deactivated && (
        <p className="text-destructive">
          The playlist no longer exists, so this scheduler was turned off.
        </p>
      )}
    </div>
  )
}

/** "Last scan 5 min ago · Added 2 videos" for a scheduler card. */
export function LastRunLine({ run, now }: { run: RunView; now: Date }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusBadge status={run.status} />
      <span className="truncate">
        {runHeadline(run)}
        {run.status !== 'running' && (
          <span className="text-muted-foreground"> · {formatRelative(run.startedAt, now)}</span>
        )}
      </span>
    </span>
  )
}
