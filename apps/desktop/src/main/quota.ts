import { DAILY_QUOTA, nextQuotaReset, quotaDay } from '@auto-yt/core'
import type { QuotaStatus } from '../shared/api'
import type { SqliteStorage } from './db/sqlite-storage'

/**
 * Counts the YouTube API units this app spends per quota day (Pacific Time),
 * persisted so the count survives restarts. It's an estimate: other apps
 * using the same Google Cloud project aren't counted.
 */
export function createQuotaTracker(deps: {
  storage: Pick<SqliteStorage, 'addQuotaUnits' | 'quotaUnitsUsed'>
  now: () => Date
  /** Called after every change, e.g. to push the new status to the window. */
  onChange?: (status: QuotaStatus) => void
  limit?: number
}) {
  const limit = deps.limit ?? DAILY_QUOTA

  function status(): QuotaStatus {
    const now = deps.now()
    return {
      used: deps.storage.quotaUnitsUsed(quotaDay(now)),
      limit,
      resetsAt: nextQuotaReset(now).toISOString(),
    }
  }

  return {
    status,
    /** Units left today by this app's own count (never below 0). */
    remaining: () => Math.max(0, limit - status().used),
    /** Plug into the YouTube client's `onQuota`. */
    record(units: number): void {
      deps.storage.addQuotaUnits(quotaDay(deps.now()), units)
      deps.onChange?.(status())
    },
  }
}

export type QuotaTracker = ReturnType<typeof createQuotaTracker>
