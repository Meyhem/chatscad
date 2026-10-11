import { db as defaultDb, DEFAULT_SETTINGS, type ChatScadDb, type Settings } from './db'

export type Prefs = Pick<Settings, 'variantCount' | 'lowQualityPreview' | 'transcriptionModel'>

/** The M4 settings from a stored row, with defaults for rows written before M4 and for invalid values. */
export function prefsFrom(row: Partial<Settings> | undefined): Prefs {
  const model = typeof row?.transcriptionModel === 'string' ? row.transcriptionModel.trim() : ''
  return {
    variantCount: row?.variantCount === 3 ? 3 : 1,
    lowQualityPreview: row?.lowQualityPreview === true,
    transcriptionModel: model || DEFAULT_SETTINGS.transcriptionModel,
  }
}

export async function readPrefs(database: ChatScadDb = defaultDb): Promise<Prefs> {
  return prefsFrom(await database.settings.get('app'))
}

export async function writePrefs(patch: Partial<Prefs>, database: ChatScadDb = defaultDb): Promise<Prefs> {
  const current = await database.settings.get('app')
  const next = prefsFrom({ ...current, ...patch })
  await database.settings.put({ ...DEFAULT_SETTINGS, ...current, ...next, id: 'app' })
  return next
}
