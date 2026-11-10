/** A YouTube channel, enough to show it in the UI and scan its uploads. */
export interface Channel {
  /** "UC…" channel id. */
  id: string
  title: string
  /** "@handle", when the channel has one. */
  handle?: string
  thumbnailUrl?: string
  /** Undefined when the channel hides its subscriber count. */
  subscriberCount?: number
  /** "UU…" playlist that lists every upload of the channel. */
  uploadsPlaylistId: string
}

/** One of the signed-in user's playlists. */
export interface Playlist {
  id: string
  title: string
  itemCount: number
  thumbnailUrl?: string
}

/** An entry of a channel's uploads playlist. */
export interface UploadItem {
  videoId: string
  publishedAt: Date
}

/** The fields of a video needed to decide whether it's a regular upload. */
export interface VideoDetails {
  id: string
  title: string
  channelId: string
  publishedAt: Date
  /** 0 for upcoming streams/premieres (YouTube reports "P0D"). */
  durationSeconds: number
  liveBroadcastContent: 'none' | 'live' | 'upcoming'
  /** Present for livestreams (live, upcoming or finished) and premieres. */
  hasLiveStreamingDetails: boolean
}
