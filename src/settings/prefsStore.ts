import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../db/db'
import { readPrefs, writePrefs, type Prefs } from '../db/prefs'

export interface PrefsState extends Prefs {
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Prefs>): Promise<void>
}

/** In-memory mirror of the M4 settings, so render code can read them synchronously. */
export const usePrefs = create<PrefsState>()((set) => ({
  variantCount: DEFAULT_SETTINGS.variantCount,
  lowQualityPreview: DEFAULT_SETTINGS.lowQualityPreview,
  transcriptionModel: DEFAULT_SETTINGS.transcriptionModel,
  loaded: false,
  load: async () => set({ ...(await readPrefs()), loaded: true }),
  update: async (patch) => {
    set(patch)
    set(await writePrefs(patch))
  },
}))
