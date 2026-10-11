// @vitest-environment node
import 'fake-indexeddb/auto'
import { ProviderError } from '../ai/types'
import { db, type ProviderProfile } from '../db/db'
import { getSettings } from '../db/settings'
import { useSettingsStore } from '../settings/settingsStore'
import { resetDb } from '../test/resetDb'
import {
  decryptString, deriveKey, disableLock, enableLock, encryptString, forgetLockedKeys, fromBase64, isUnlocked, lock, LOCKED_MESSAGE,
  PBKDF2_ITERATIONS, resolveApiKey, sealProfile, unlock, unlockedKeyFor,
} from './lock'

const profile = (id: string, apiKey: string): ProviderProfile => ({
  id, name: id, adapter: 'openai-compatible', baseUrl: 'https://api.example.test/v1', apiKey, defaultModel: 'm', cachedModels: [],
  capabilities: { streaming: true, vision: false, audio: false }, priceTable: {}, createdAt: 1, updatedAt: 1,
})

const PASS = 'correct horse battery'

beforeEach(async () => {
  await resetDb()
  lock()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  await db.providerProfiles.bulkPut([profile('openai', 'sk-openai-123'), profile('ollama', '')])
})

it('encrypts and decrypts with AES-GCM, with a fresh IV each time', async () => {
  const key = await deriveKey(PASS, new Uint8Array(16), 1_000)
  const a = await encryptString(key, 'sk-1')
  const b = await encryptString(key, 'sk-1')
  expect(a).not.toBe(b)
  expect(await decryptString(key, a)).toBe('sk-1')
  const other = await deriveKey('wrong passphrase', new Uint8Array(16), 1_000)
  await expect(decryptString(other, a)).rejects.toThrow()
})

it('derives the key with PBKDF2, SHA-256, 310,000 iterations and a random 16-byte salt', async () => {
  const spy = vi.spyOn(crypto.subtle, 'deriveKey')
  await enableLock(PASS)
  expect(PBKDF2_ITERATIONS).toBe(310_000)
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310_000 }),
    expect.anything(),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const s = await getSettings()
  expect(fromBase64(s.lockSalt!)).toHaveLength(16)
  spy.mockRestore()
})

it('turns the lock on: keys become ciphertext, empty keys stay empty, settings record it', async () => {
  await enableLock(PASS)
  const stored = await db.providerProfiles.get('openai')
  expect(stored).toMatchObject({ keyEncrypted: true })
  expect(stored!.apiKey).not.toContain('sk-openai')
  expect(await db.providerProfiles.get('ollama')).toMatchObject({ apiKey: '', keyEncrypted: false })
  expect(useSettingsStore.getState().settings).toMatchObject({ lockMode: true, lockVerifier: expect.any(String) })
  expect(isUnlocked()).toBe(true)
  expect(resolveApiKey(stored!)).toBe('sk-openai-123')
  await expect(enableLock('short')).rejects.toThrow('Use a passphrase of at least 8 characters')
})

it('refuses provider calls while locked, never handing out the ciphertext', async () => {
  await enableLock(PASS)
  lock()
  const stored = (await db.providerProfiles.get('openai'))!
  expect(() => resolveApiKey(stored)).toThrow(ProviderError)
  try {
    resolveApiKey(stored)
  } catch (e) {
    expect(e).toMatchObject({ kind: 'auth', message: LOCKED_MESSAGE })
  }
  expect(resolveApiKey((await db.providerProfiles.get('ollama'))!)).toBe('')
})

it('unlocks only with the right passphrase', async () => {
  await enableLock(PASS)
  lock()
  expect(await unlock('wrong passphrase')).toBe(false)
  expect(isUnlocked()).toBe(false)
  expect(await unlock(PASS)).toBe(true)
  expect(unlockedKeyFor('openai')).toBe('sk-openai-123')
})

it('seals profiles the M2 form saves', async () => {
  const plain = await sealProfile(profile('x', 'sk-plain'))
  expect(plain.apiKey).toBe('sk-plain')
  expect(plain.keyEncrypted ?? false).toBe(false)

  await enableLock(PASS)
  const sealed = await sealProfile(profile('x', 'sk-new'))
  expect(sealed.keyEncrypted).toBe(true)
  expect(sealed.apiKey).not.toBe('sk-new')
  expect(await sealProfile(sealed)).toBe(sealed)
  expect(unlockedKeyFor('x')).toBe('sk-new')

  await db.providerProfiles.put(sealed)
  lock()
  expect(await sealProfile({ ...sealed, name: 'renamed' })).toMatchObject({ name: 'renamed', apiKey: sealed.apiKey })
  await expect(sealProfile({ ...sealed, apiKey: 'sk-changed' })).rejects.toThrow('Unlock your keys in Settings › Security before changing a key')
})

it('turns the lock off with the keys back in plain text', async () => {
  await enableLock(PASS)
  await disableLock()
  expect(await db.providerProfiles.get('openai')).toMatchObject({ apiKey: 'sk-openai-123', keyEncrypted: false })
  expect(await getSettings()).toMatchObject({ lockMode: false, lockSalt: null, lockVerifier: null })
  expect(isUnlocked()).toBe(false)
})

it('forgets locked keys when the passphrase is lost', async () => {
  await enableLock(PASS)
  lock()
  await expect(disableLock()).rejects.toThrow('Unlock the keys before turning the lock off')
  await forgetLockedKeys()
  expect(await db.providerProfiles.get('openai')).toMatchObject({ apiKey: '', keyEncrypted: false })
  expect(useSettingsStore.getState().settings.lockMode).toBe(false)
})
