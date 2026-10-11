import { db, type ChatScadDb, type ProviderProfile } from './db'

export async function getActiveProfile(database: ChatScadDb = db): Promise<ProviderProfile | null> {
  const settings = await database.settings.get('app')
  if (!settings?.activeProfileId) return null
  return (await database.providerProfiles.get(settings.activeProfileId)) ?? null
}
