import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEncryptedFileStore,
  createPlainFileStore,
  parseStoredAuth,
  type Cipher,
} from './token-store'

/** Reversible fake "encryption" so tests can tell plaintext was not written. */
const fakeCipher = (available = true, rotated = false) => {
  const encrypted: string[] = []
  const cipher: Cipher = {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (s) => {
      encrypted.push(s)
      return Buffer.from(`enc:${Buffer.from(s).toString('base64')}`)
    },
    decryptStringAsync: async (b) => {
      const text = b.toString()
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return { result: Buffer.from(text.slice(4), 'base64').toString(), shouldReEncrypt: rotated }
    },
  }
  return Object.assign(cipher, { encrypted })
}

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

  it('re-encrypts when the OS key was rotated', async () => {
    await createEncryptedFileStore(file, fakeCipher()).save(auth)
    const rotated = fakeCipher(true, true)
    expect(await createEncryptedFileStore(file, rotated).load()).toEqual(auth)
    expect(rotated.encrypted).toHaveLength(1)
  })

  it('refuses to save when OS encryption is unavailable', async () => {
    const store = createEncryptedFileStore(file, fakeCipher(false))
    await expect(store.save(auth)).rejects.toThrow(/encryption is unavailable/)
  })
})

describe('createPlainFileStore (server)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'auto-yt-plain-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('round-trips a sign-in through a JSON file, creating the folder', async () => {
    const file = join(dir, 'nested', 'auth.json')
    const store = createPlainFileStore(file)
    expect(await store.load()).toBeNull()
    await store.save(auth)
    expect(await store.load()).toEqual(auth)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(auth)
    await store.clear()
    expect(await store.load()).toBeNull()
  })

  it.runIf(process.platform !== 'win32')('writes the file readable by its owner only', async () => {
    const file = join(dir, 'auth.json')
    await writeFile(file, '{}', { mode: 0o644 })
    await createPlainFileStore(file).save(auth)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('treats a corrupt or incomplete file as signed out', async () => {
    const file = join(dir, 'auth.json')
    for (const text of ['not json', '{}', '{"refreshToken":""}', '{"refreshToken":"x"}']) {
      await writeFile(file, text)
      expect(await createPlainFileStore(file).load()).toBeNull()
    }
  })

  it('keeps only the known fields', () => {
    expect(parseStoredAuth(JSON.stringify({ ...auth, extra: 1 }))).toEqual(auth)
  })
})
