// The API the preload exposes to the window as `window.api`, and the data it carries.
import type { Channel, Playlist, SkipReason } from '../main/core/youtube/types'

export type { Channel, Playlist, SkipReason }

export interface Profile {
  name: string
  pictureUrl?: string
}

export interface AuthStatus {
  configured: boolean // false until the Google client is set in .env
  signedIn: boolean
  signingIn: boolean // waiting for the browser
  profile?: Profile
}

export interface SchedulerInput {
  name: string
  playlistId: string
  playlistTitle: string
  intervalDays: number
  timeOfDay: string // "HH:mm"
  timezone: string
  channels: Channel[]
}

export interface SchedulerView extends SchedulerInput {
  id: string
  active: boolean
  createdAt: string // ISO
  lastSuccessAt?: string
  nextRunAt: string
  lastRun?: RunView
}

export type RunStatus = 'running' | 'ok' | 'partial' | 'error'

export interface RunDetails {
  added: { id: string; title: string; publishedAt: string }[] // oldest first
  skipped: { videoId: string; title?: string; reason: SkipReason }[]
  unavailableChannels: { id: string; title: string }[]
  deactivated: boolean // turned off because the playlist is gone
}

export interface RunView {
  id: string
  schedulerId: string
  schedulerName: string
  trigger: 'manual' | 'scheduled'
  status: RunStatus
  startedAt: string
  finishedAt?: string
  addedCount: number
  error?: { kind: string; message: string }
  details?: RunDetails
}

/** Every call rejects with a plain Error whose message is ready to show. */
export interface Api {
  auth: {
    getStatus(): Promise<AuthStatus>
    signIn(): Promise<AuthStatus>
    cancelSignIn(): Promise<void>
    signOut(): Promise<AuthStatus>
    onStatusChange(listener: (status: AuthStatus) => void): () => void
  }
  youtube: {
    listMyPlaylists(): Promise<Playlist[]>
  }
  channels: {
    search(query: string): Promise<Channel[]> // also accepts a URL, @handle or channel id
  }
  schedulers: {
    list(): Promise<SchedulerView[]>
    create(input: SchedulerInput): Promise<SchedulerView>
    update(id: string, input: SchedulerInput): Promise<SchedulerView>
    setActive(id: string, active: boolean): Promise<SchedulerView>
    remove(id: string): Promise<void>
    runNow(id: string): Promise<RunView>
  }
  runs: {
    list(): Promise<RunView[]>
    onChange(listener: () => void): () => void // a scan started or finished
  }
  scans: {
    isPaused(): Promise<boolean>
    setPaused(paused: boolean): Promise<boolean>
    onPausedChange(listener: (paused: boolean) => void): () => void
  }
}

/** How main answers every IPC call (Electron would otherwise prefix error messages). */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
