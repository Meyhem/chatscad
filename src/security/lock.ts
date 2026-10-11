import { ProviderError } from '../ai/types'
import { db, type ProviderProfile } from '../db/db'
import { getSettings, updateSettings } from '../db/settings'
import { useSettingsStore } from '../settings/settingsStore'

export const PBKDF2_ITERATIONS = 310_000
export const LOCKED_MESSAGE = 'Your API keys are locked. Unlock them in Settings › Security.'
const VERIFIER = 'chatscad-lock-v1'

// Held in memory only: closing the tab forgets them (spec "Security").
let unlockedKey: CryptoKey | null = null
let plainKeys = new Map<string, string>()

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function deriveKey(passphrase: string, salt: BufferSource, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptString(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toBase64(out)
}

export async function decryptString(key: CryptoKey, b64: string): Promise<string> {
  const bytes = fromBase64(b64)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
  return new TextDecoder().decode(plain)
}

export const isUnlocked = (): boolean => unlockedKey !== null

const lockListeners = new Set<() => void>()

/** Called after every lock state change, so state that holds profiles (the providers store) can reload them. */
export function onLockChange(fn: () => void): () => void {
  lockListeners.add(fn)
  return () => lockListeners.delete(fn)
}

function notifyLockChange(): void {
  for (const fn of lockListeners) fn()
}

export function lock(): void {
  unlockedKey = null
  plainKeys = new Map()
  notifyLockChange()
}

export const unlockedKeyFor = (profileId: string): string | null => plainKeys.get(profileId) ?? null

async function writeProfilesAndSettings(profiles: ProviderProfile[], patch: Parameters<typeof updateSettings>[0]): Promise<void> {
  await db.transaction('rw', db.providerProfiles, db.settings, async () => {
    await db.providerProfiles.bulkPut(profiles)
    await updateSettings(patch)
  })
  await useSettingsStore.getState().load()
  notifyLockChange()
}

export async function enableLock(passphrase: string): Promise<void> {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt)
  const plain = new Map<string, string>()
  const sealed: ProviderProfile[] = []
  for (const p of await db.providerProfiles.toArray()) {
    if (p.apiKey === '') {
      sealed.push({ ...p, keyEncrypted: false })
      continue
    }
    plain.set(p.id, p.apiKey)
    sealed.push({ ...p, apiKey: await encryptString(key, p.apiKey), keyEncrypted: true })
  }
  await writeProfilesAndSettings(sealed, { lockMode: true, lockSalt: toBase64(salt), lockVerifier: await encryptString(key, VERIFIER) })
  unlockedKey = key
  plainKeys = plain
}

export async function unlock(passphrase: string): Promise<boolean> {
  const s = await getSettings()
  if (!s.lockMode || !s.lockSalt || !s.lockVerifier) return true
  const key = await deriveKey(passphrase, fromBase64(s.lockSalt))
  try {
    if ((await decryptString(key, s.lockVerifier)) !== VERIFIER) return false
  } catch {
    return false
  }
  const plain = new Map<string, string>()
  for (const p of await db.providerProfiles.toArray()) {
    if (!p.keyEncrypted || p.apiKey === '') continue
    try {
      plain.set(p.id, await decryptString(key, p.apiKey))
    } catch {
      // A damaged key stays locked; the provider call then reports it.
    }
  }
  unlockedKey = key
  plainKeys = plain
  notifyLockChange()
  return true
}

export async function disableLock(): Promise<void> {
  if (!unlockedKey) throw new Error('Unlock the keys before turning the lock off')
  const opened = (await db.providerProfiles.toArray()).map((p) =>
    p.keyEncrypted ? { ...p, apiKey: plainKeys.get(p.id) ?? '', keyEncrypted: false } : p,
  )
  await writeProfilesAndSettings(opened, { lockMode: false, lockSalt: null, lockVerifier: null })
  lock()
}

export async function forgetLockedKeys(): Promise<void> {
  const cleared = (await db.providerProfiles.toArray()).map((p) => (p.keyEncrypted ? { ...p, apiKey: '', keyEncrypted: false } : p))
  await writeProfilesAndSettings(cleared, { lockMode: false, lockSalt: null, lockVerifier: null })
  lock()
}

/** The key createProvider() may use. Never returns ciphertext. */
export function resolveApiKey(profile: ProviderProfile): string {
  if (!profile.keyEncrypted) return profile.apiKey
  const key = plainKeys.get(profile.id)
  if (key === undefined) throw new ProviderError('auth', LOCKED_MESSAGE)
  return key
}

/** What M2's profile writer stores. */
export async function sealProfile(profile: ProviderProfile): Promise<ProviderProfile> {
  const { lockMode } = await getSettings()
  // Without lock mode the stored profile is exactly what the caller saved; a missing keyEncrypted means plain text.
  if (!lockMode) return profile
  if (profile.apiKey === '') {
    plainKeys.delete(profile.id)
    return { ...profile, keyEncrypted: false }
  }
  if (!unlockedKey) {
    const stored = await db.providerProfiles.get(profile.id)
    if (profile.keyEncrypted && stored?.apiKey === profile.apiKey) return profile
    throw new Error('Unlock your keys in Settings › Security before changing a key')
  }
  if (profile.keyEncrypted) {
    try {
      plainKeys.set(profile.id, await decryptString(unlockedKey, profile.apiKey))
      return profile
    } catch {
      // The form put a new plain key where the ciphertext was.
    }
  }
  plainKeys.set(profile.id, profile.apiKey)
  return { ...profile, apiKey: await encryptString(unlockedKey, profile.apiKey), keyEncrypted: true }
}
