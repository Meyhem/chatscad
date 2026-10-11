import { layoutFrom, type PanelLayout } from '../layout/panelLayout'
import { db as defaultDb, DEFAULT_SETTINGS, type ChatScadDb, type Settings } from './db'

export type Prefs = Pick<Settings, 'variantCount' | 'lowQualityPreview' | 'transcriptionModel'> & { panelLayout: PanelLayout }

/** The M4 settings from a stored row, with defaults for rows written before M4 and for invalid values. */
export function prefsFrom(row: Partial<Settings> | undefined): Prefs {
  const model = typeof row?.transcriptionModel === 'string' ? row.transcriptionModel.trim() : ''
  return {
    variantCount: row?.variantCount === 3 ? 3 : 1,
    lowQualityPreview: row?.lowQualityPreview === true,
    transcriptionModel: model || DEFAULT_SETTINGS.transcriptionModel,
    panelLayout: layoutFrom(row?.panelLayout),
  }
}

export async function readPrefs(database: ChatScadDb = defaultDb): Promise<Prefs> {
  return prefsFrom(await database.settings.get('app'))
}

export async function writePrefs(patch: Partial<Prefs>, database: ChatScadDb = defaultDb): Promise<Prefs> {
  // One transaction, so a concurrent updateSettings() cannot write back a stale copy of the row.
  return database.transaction('rw', database.settings, async () => {
    const current = await database.settings.get('app')
    const next = prefsFrom({ ...current, ...patch })
    // The layout stays null (follow the defaults) until the person actually resizes something.
    const panelLayout = 'panelLayout' in patch ? next.panelLayout : (current?.panelLayout ?? null)
    await database.settings.put({ ...DEFAULT_SETTINGS, ...current, ...next, panelLayout, id: 'app' })
    return next
  })
}
