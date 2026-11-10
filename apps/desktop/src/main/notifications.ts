import type { RunView } from '../shared/api'

export interface NotificationText {
  title: string
  body: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Up to three titles, then "and N more". */
function titles(run: RunView): string {
  const added = run.details?.added ?? []
  const shown = added.slice(0, 3).map((v) => `• ${v.title}`)
  if (added.length > 3) shown.push(`…and ${added.length - 3} more`)
  return shown.join('\n')
}

/**
 * What to tell the user after a scan, or null when there's nothing worth a
 * notification (a successful scan with no new videos).
 */
export function notificationFor(run: RunView, playlistTitle: string): NotificationText | null {
  const name = run.schedulerName
  const unavailable = run.details?.unavailableChannels ?? []
  const channelNote =
    unavailable.length > 0
      ? `\n${plural(unavailable.length, 'channel')} couldn't be read (deleted?): ${unavailable
          .map((c) => c.title)
          .join(', ')}`
      : ''

  if (run.status === 'ok') {
    if (run.addedCount === 0) return channelNote ? { title: name, body: channelNote.trim() } : null
    return {
      title: `Added ${plural(run.addedCount, 'video')} to ${playlistTitle}`,
      body: titles(run) + channelNote,
    }
  }

  const kind = run.error?.kind
  if (kind === 'unauthorized') {
    return {
      title: 'auto-yt: please sign in again',
      body: 'Your Google sign-in expired or was revoked. Open auto-yt and sign in to resume scans.',
    }
  }
  if (run.details?.deactivated || kind === 'playlistNotFound') {
    return {
      title: `${name} was turned off`,
      body: `Its playlist "${playlistTitle}" no longer exists. Pick another playlist and turn the scheduler back on.`,
    }
  }

  const prefix =
    run.status === 'partial'
      ? `Added ${plural(run.addedCount, 'video')}, then stopped. The rest will be added next scan.\n`
      : ''
  if (kind === 'quotaExceeded') {
    return {
      title: `${name}: YouTube daily quota used up`,
      body: `${prefix}Scanning works again after the quota resets (midnight Pacific Time).`,
    }
  }
  if (kind === 'playlistFull') {
    return {
      title: `${name}: playlist is full`,
      body: `${prefix}"${playlistTitle}" has reached YouTube's 5,000-video limit. Remove some videos or pick another playlist.`,
    }
  }
  return {
    title: `${name}: scan ${run.status === 'partial' ? 'stopped early' : 'failed'}`,
    body: `${prefix}${run.error?.message ?? 'Unknown error.'}`,
  }
}
