import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEncryptedFileStore, type Cipher } from './token-store'

/** Reversible fake "encryption" so tests can tell plaintext was not written. */
const fakeCipher = (available = true): Cipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => {
    const text = b.toString()
    if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
    return Buffer.from(text.slice(4), 'base64').toString()
  },
})

const auth = {
  refreshToken: '1//secret-refresh',
  profile: { name: 'Khang', pictureUrl: 'https://x/p.png' },
}

describe('createEncryptedFileStore', () => {
  let dir: string
  let file: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'auto-yt-store-'))
    file = join(dir, 'nested', 'auth.bin')
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('round-trips auth through an encrypted file (creating folders)', async () => {
    const store = createEncryptedFileStore(file, fakeCipher())
    expect(await store.load()).toBeNull()
    await store.save(auth)
    expect(await store.load()).toEqual(auth)
    expect((await readFile(file)).toString()).not.toContain('secret-refresh')
  })

  it('clears the file, and clearing twice is fine', async () => {
    const store = createEncryptedFileStore(file, fakeCipher())
    await store.save(auth)
    await store.clear()
    await store.clear()
    expect(await store.load()).toBeNull()
  })

  it('treats a corrupted or foreign file as signed out', async () => {
    const store = createEncryptedFileStore(join(dir, 'auth.bin'), fakeCipher())
    await writeFile(join(dir, 'auth.bin'), 'garbage')
    expect(await store.load()).toBeNull()
  })

  it('refuses to save when OS encryption is unavailable', async () => {
    const store = createEncryptedFileStore(file, fakeCipher(false))
    await expect(store.save(auth)).rejects.toThrow(/encryption is unavailable/)
  })
})
