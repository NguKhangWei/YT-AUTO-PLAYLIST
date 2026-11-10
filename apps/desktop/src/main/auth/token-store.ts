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
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** Stores auth as one encrypted file. A missing or unreadable file means "signed out". */
export function createEncryptedFileStore(filePath: string, cipher: Cipher): TokenStore {
  return {
    async load() {
      let data: Buffer
      try {
        data = await readFile(filePath)
      } catch {
        return null
      }
      try {
        const parsed = JSON.parse(cipher.decryptString(data)) as Partial<StoredAuth>
        if (typeof parsed.refreshToken !== 'string' || !parsed.profile) return null
        return parsed as StoredAuth
      } catch {
        return null // corrupted, or encrypted by another OS user
      }
    },
    async save(auth) {
      if (!cipher.isEncryptionAvailable()) {
        throw new Error('OS encryption is unavailable, so the sign-in cannot be stored safely.')
      }
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, cipher.encryptString(JSON.stringify(auth)))
    },
    async clear() {
      await rm(filePath, { force: true })
    },
  }
}
