import { useEffect, useState } from 'react'
import type { QuotaStatus } from '../../../shared/api'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

/** "API 1,234 / 10,000" with a bar; turns amber at 80% and red at 100%. */
export function QuotaMeter() {
  const api = useApi()
  const [quota, setQuota] = useState<QuotaStatus | null>(null)

  useEffect(() => {
    let alive = true
    api.quota.get().then(
      (q) => alive && setQuota(q),
      () => undefined, // the meter is informational; ignore failures
    )
    const off = api.quota.onChange((q) => alive && setQuota(q))
    return () => {
      alive = false
      off()
    }
  }, [api])

  if (!quota) return null
  const ratio = Math.min(1, quota.used / quota.limit)
  const resets = new Date(quota.resetsAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const n = (x: number) => x.toLocaleString('en-US')

  return (
    <div
      className="flex flex-col gap-1 text-xs text-muted-foreground"
      title={`YouTube API units used by this app today. Resets at ${resets} (midnight Pacific Time).`}
    >
      <span>
        API {n(quota.used)} / {n(quota.limit)}
      </span>
      <div
        role="meter"
        aria-label="YouTube API quota used today"
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={quota.used}
        className="h-1 w-28 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            'h-full rounded-full',
            ratio >= 1 ? 'bg-destructive' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-primary',
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
