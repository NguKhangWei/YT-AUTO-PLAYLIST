// Types shared by main, preload and renderer. Type-only (plus type imports from
// core) so every process can import them.
import type { Playlist } from '@auto-yt/core'

export type { Playlist }

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
}
