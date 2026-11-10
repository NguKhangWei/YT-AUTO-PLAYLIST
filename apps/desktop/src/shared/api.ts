// The API the preload script exposes on `window.api`. Type-only and
// dependency-free so both the preload (Node types) and renderer (DOM types)
// can import it.
export interface Api {
  versions: {
    electron: string
    chrome: string
    node: string
  }
}
