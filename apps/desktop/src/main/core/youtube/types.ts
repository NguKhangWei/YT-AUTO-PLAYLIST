// YouTube data as the app uses it (a small subset of the API's fields).

export interface Channel {
  id: string // "UC…"
  title: string
  handle?: string // "@name"
  thumbnailUrl?: string
  subscriberCount?: number // undefined when hidden
  uploadsPlaylistId: string // "UU…"
}

export interface Playlist {
  id: string
  title: string
  itemCount: number
  thumbnailUrl?: string
}

export interface UploadItem {
  videoId: string
  publishedAt: Date
}

export interface VideoDetails {
  id: string
  title: string
  channelId: string
  publishedAt: Date
  durationSeconds: number
  liveBroadcastContent: 'none' | 'live' | 'upcoming'
  hasLiveStreamingDetails: boolean // livestreams and premieres
}

/** Why a video wasn't added to the playlist. */
export type SkipReason = 'short' | 'livestream' | 'live' | 'upcoming' | 'inPlaylist' | 'unavailable'
