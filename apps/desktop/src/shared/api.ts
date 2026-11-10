// Types shared by main, preload and renderer. Type-only (plus type imports from
// core) so every process can import them.
import type { Channel, Playlist } from '@auto-yt/core'

export type { Channel, Playlist }

/** What the editor sends to create or update a scheduler. */
export interface SchedulerInput {
  name: string
  playlistId: string
  /** Shown in the list without another API call. */
  playlistTitle: string
  /** 1–30. */
  intervalDays: number
  /** "HH:mm", 24-hour. */
  timeOfDay: string
  /** IANA zone, default "Asia/Kuala_Lumpur". */
  timezone: string
}

/** A scheduler as the UI shows it. Dates are ISO strings. */
export interface SchedulerView extends SchedulerInput {
  id: string
  active: boolean
  createdAt: string
  lastSuccessAt?: string
  nextRunAt: string
  channels: Channel[]
}

/** The signed-in Google account, for the header. */
export interface Profile {
  name: string
  pictureUrl?: string
}

export interface AuthStatus {
  /** False until the Google client ID/secret are set in .env. */
  configured: boolean
  signedIn: boolean
  /** A browser sign-in is in progress. */
  signingIn: boolean
  profile?: Profile
}

/** An error crossing IPC, with a machine-readable kind (e.g. a YouTube error kind). */
export interface ApiErrorInfo {
  kind: string
  message: string
}

/**
 * Every IPC handler resolves to this envelope. Errors crossing IPC or the
 * contextBridge lose everything but their message, so they travel as data.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorInfo }

/** The API the renderer uses. Calls reject with `ApiError` (see renderer lib/api). */
export interface Api {
  versions: { electron: string; chrome: string; node: string }
  auth: {
    getStatus(): Promise<AuthStatus>
    /** Opens the system browser; resolves once signed in. */
    signIn(): Promise<AuthStatus>
    cancelSignIn(): Promise<void>
    signOut(): Promise<AuthStatus>
    /** Subscribe to status changes (e.g. signed out after a revoked token). Returns unsubscribe. */
    onStatusChange(listener: (status: AuthStatus) => void): () => void
  }
  youtube: {
    listMyPlaylists(): Promise<Playlist[]>
  }
  schedulers: {
    list(): Promise<SchedulerView[]>
    /** Rejects with kind "validation" and a readable message for bad input or a used playlist. */
    create(input: SchedulerInput): Promise<SchedulerView>
    update(id: string, input: SchedulerInput): Promise<SchedulerView>
    setActive(id: string, active: boolean): Promise<SchedulerView>
    remove(id: string): Promise<void>
  }
}

/** Turn `() => Promise<T>` methods into `() => Promise<IpcResult<T>>`. */
type Enveloped<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<IpcResult<R>>
    : T[K]
}

/** What the preload exposes as `window.bridge`: `Api` with envelopes instead of throws. */
export interface Bridge {
  versions: Api['versions']
  auth: Enveloped<Api['auth']>
  youtube: Enveloped<Api['youtube']>
  schedulers: Enveloped<Api['schedulers']>
}
