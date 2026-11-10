import { vi } from 'vitest'
import type { Api, AuthStatus, Playlist } from '../../../shared/api'

export const signedOut: AuthStatus = { configured: true, signedIn: false, signingIn: false }
export const signedIn: AuthStatus = {
  configured: true,
  signedIn: true,
  signingIn: false,
  profile: { name: 'Khang Wei', pictureUrl: 'https://lh3.googleusercontent.com/a/p' },
}

/** A controllable fake of the renderer `Api`. `emit` simulates a main-process status push. */
export function fakeApi(initial: AuthStatus, playlists: Playlist[] = []) {
  const listeners = new Set<(s: AuthStatus) => void>()
  const api = {
    versions: { electron: '45', chrome: '156', node: '24' },
    auth: {
      getStatus: vi.fn(async () => initial),
      signIn: vi.fn(async () => signedIn),
      cancelSignIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => signedOut),
      onStatusChange: vi.fn((l: (s: AuthStatus) => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      }),
    },
    youtube: {
      listMyPlaylists: vi.fn(async () => playlists),
    },
  } satisfies Api
  return { api, emit: (s: AuthStatus) => listeners.forEach((l) => l(s)) }
}
