import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Profile } from '../../shared/api'

/** What survives a restart: the long-lived refresh token and who it belongs to. */
export interface StoredAuth {
  refreshToken: string
  profile: Profile
}

export interface TokenStore {
  load(): Promise<StoredAuth | null>
  save(auth: StoredAuth): Promise<void>
  clear(): Promise<void>
}

/** Electron `safeStorage` (Windows DPAPI / macOS Keychain / libsecret), injectable for tests. */
export interface Cipher {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plain: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

/** Stores auth as one encrypted file. A missing or unreadable file means "signed out". */
export function createEncryptedFileStore(filePath: string, cipher: Cipher): TokenStore {
  const store: TokenStore = {
    async load() {
      let data: Buffer
      try {
        data = await readFile(filePath)
      } catch {
        return null
      }
      let auth: StoredAuth
      let reEncrypt: boolean
      try {
        const { result, shouldReEncrypt } = await cipher.decryptStringAsync(data)
        const parsed = JSON.parse(result) as Partial<StoredAuth>
        if (typeof parsed.refreshToken !== 'string' || !parsed.profile) return null
        auth = parsed as StoredAuth
        reEncrypt = shouldReEncrypt
      } catch {
        return null // corrupted, or encrypted by another OS user
      }
      // The OS key was rotated: store it again under the new key.
      if (reEncrypt) await store.save(auth).catch(() => undefined)
      return auth
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
