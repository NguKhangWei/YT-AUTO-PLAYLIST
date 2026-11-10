import type { Bridge } from '../../shared/api'

declare global {
  interface Window {
    /** Exposed by the preload script; use `useApi()` instead of touching it directly. */
    bridge?: Bridge
  }
}

export {}
