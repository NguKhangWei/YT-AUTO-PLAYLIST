// Short descriptions of a scan's outcome.
import type { RunView } from '../../../shared/api'
import { plural } from '../../../shared/format'

/** E.g. "Added 3 videos", "No new videos" or "Failed: Quota used up". */
export function runHeadline(run: RunView): string {
  const added = plural(run.addedCount, 'video')
  switch (run.status) {
    case 'running':
      return 'Scanning…'
    case 'ok':
      return run.addedCount === 0 ? 'No new videos' : `Added ${added}`
    case 'partial':
      return `Added ${added}, then stopped: ${run.error?.message ?? ''}`
    case 'error':
      return `Failed: ${run.error?.message ?? 'unknown error'}`
  }
}
