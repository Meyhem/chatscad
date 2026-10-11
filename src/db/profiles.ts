import { db, type ProviderProfile } from './db'

export async function listProfiles(): Promise<ProviderProfile[]> {
  return (await db.providerProfiles.toArray()).sort((a, b) => a.createdAt - b.createdAt)
}

export function getProfile(id: string): Promise<ProviderProfile | undefined> {
  return db.providerProfiles.get(id)
}

export async function saveProfile(profile: ProviderProfile): Promise<ProviderProfile> {
  const saved = { ...profile, updatedAt: Date.now() }
  await db.providerProfiles.put(saved)
  return saved
}

export async function deleteProfile(id: string): Promise<void> {
  await db.transaction('rw', db.providerProfiles, db.settings, async () => {
    await db.providerProfiles.delete(id)
    const settings = await db.settings.get('app')
    if (settings?.activeProfileId === id) await db.settings.put({ ...settings, activeProfileId: null, activeModel: null })
  })
}

export function newProfile(fields: Pick<ProviderProfile, 'name' | 'adapter' | 'baseUrl'> & Partial<ProviderProfile>): ProviderProfile {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    apiKey: '',
    defaultModel: '',
    cachedModels: [],
    capabilities: { streaming: true, vision: false, audio: false },
    priceTable: {},
    createdAt: now,
    updatedAt: now,
    ...fields,
  }
}
