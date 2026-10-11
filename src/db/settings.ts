import { DEFAULT_SETTINGS, db, type Settings } from './db'

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await db.settings.get('app')) }
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const next: Settings = { ...(await getSettings()), ...patch, id: 'app' }
  await db.settings.put(next)
  return next
}
