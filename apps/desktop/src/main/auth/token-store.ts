// Keeps the Google refresh token in a file: encrypted with the OS account on the desktop
// (Electron safeStorage), or plain JSON readable only by the service user on the server.
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Profile } from '../../shared/api'

export interface StoredAuth {
  refreshToken: string
  profile: Profile
}

export interface TokenStore {
  load(): Promise<StoredAuth | null>
  save(auth: StoredAuth): Promise<void>
  clear(): Promise<void>
}

export interface Cipher {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plain: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

/** A token store backed by one encrypted file; a missing or unreadable file means signed out. */
export function createEncryptedFileStore(filePath: string, cipher: Cipher): TokenStore {
  const store: TokenStore = {
    async load() {
      let data: Buffer
      try {
        data = await readFile(filePath)
      } catch {
        return null
      }
      try {
        const { result, shouldReEncrypt } = await cipher.decryptStringAsync(data)
        const auth = JSON.parse(result) as Partial<StoredAuth>
        if (typeof auth.refreshToken !== 'string' || !auth.profile) return null
        if (shouldReEncrypt) await store.save(auth as StoredAuth).catch(() => undefined) // OS key rotated
        return auth as StoredAuth
      } catch {
        return null // corrupted, or encrypted by another OS user
      }
    },
    async save(auth) {
      if (!(await cipher.isAsyncEncryptionAvailable())) {
        throw new Error('OS encryption is unavailable, so the sign-in cannot be stored safely.')
      }
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, await cipher.encryptStringAsync(JSON.stringify(auth)))
    },
    async clear() {
      await rm(filePath, { force: true })
    },
  }
  return store
}

/** Parses a stored sign-in, or null if it isn't one. */
export function parseStoredAuth(text: string): StoredAuth | null {
  try {
    const auth = JSON.parse(text) as Partial<StoredAuth>
    if (typeof auth.refreshToken !== 'string' || !auth.refreshToken) return null
    if (typeof auth.profile?.name !== 'string') return null
    return { refreshToken: auth.refreshToken, profile: auth.profile }
  } catch {
    return null
  }
}

/**
 * A token store backed by one plain JSON file with mode 600, for the server, where
 * there's no OS encryption. Writes go to a temporary file first, so a crash never
 * leaves a half-written sign-in.
 */
export function createPlainFileStore(filePath: string): TokenStore {
  return {
    async load() {
      try {
        return parseStoredAuth(await readFile(filePath, 'utf8'))
      } catch {
        return null
      }
    },
    async save(auth) {
      await mkdir(dirname(filePath), { recursive: true })
      const tmp = `${filePath}.tmp`
      await writeFile(tmp, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 })
      await chmod(tmp, 0o600) // in case the file already existed with wider permissions
      await rename(tmp, filePath)
    },
    async clear() {
      await rm(filePath, { force: true })
    },
  }
}
