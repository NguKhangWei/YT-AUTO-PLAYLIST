// Wording of the Windows notifications shown after a scan.
import type { RunView } from '../shared/api'
import { plural } from '../shared/format'

export interface NotificationText {
  title: string
  body: string
}

/** What to tell the user after a scan, or null for a successful scan with nothing new. */
export function notificationFor(run: RunView, playlistTitle: string): NotificationText | null {
  const name = run.schedulerName
  const added = run.details?.added ?? []
  const unavailable = run.details?.unavailableChannels ?? []
  const channelNote = unavailable.length
    ? `\n${plural(unavailable.length, 'channel')} couldn't be read (deleted?): ${unavailable.map((c) => c.title).join(', ')}`
    : ''

  if (run.status === 'ok') {
    if (run.addedCount === 0) return channelNote ? { title: name, body: channelNote.trim() } : null
    const titles = added.slice(0, 3).map((v) => `• ${v.title}`)
    if (added.length > 3) titles.push(`…and ${added.length - 3} more`)
    return {
      title: `Added ${plural(run.addedCount, 'video')} to ${playlistTitle}`,
      body: titles.join('\n') + channelNote,
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
