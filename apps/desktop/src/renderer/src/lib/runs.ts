import type { RunView } from '../../../shared/api'

/** One-line outcome, e.g. "Added 3 videos" or "Failed: quota used up". */
export function runHeadline(run: RunView): string {
  const n = run.addedCount
  const added = `${n} ${n === 1 ? 'video' : 'videos'}`
  switch (run.status) {
    case 'running':
      return 'Scanning…'
    case 'ok':
      return n === 0 ? 'No new videos' : `Added ${added}`
    case 'partial':
      return `Added ${added}, then stopped: ${run.error?.message ?? ''}`
    case 'error':
      return `Failed: ${run.error?.message ?? 'unknown error'}`
  }
}
