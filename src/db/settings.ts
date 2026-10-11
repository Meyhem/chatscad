import { DEFAULT_SETTINGS, db, type Settings } from './db'

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await db.settings.get('app')) }
}

/** Read and write in one transaction, so concurrent writers of the settings row never drop each other's fields. */
export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const next: Settings = { ...(await getSettings()), ...patch, id: 'app' }
    await db.settings.put(next)
    return next
  })
}
