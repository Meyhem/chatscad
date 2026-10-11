import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../db/db'
import { readPrefs, writePrefs, type Prefs } from '../db/prefs'
import { DEFAULT_LAYOUT } from '../layout/panelLayout'

export interface PrefsState extends Prefs {
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Prefs>): Promise<void>
}

let writes = 0

/** In-memory mirror of the M4 settings, so render code can read them synchronously. */
export const usePrefs = create<PrefsState>()((set) => ({
  variantCount: DEFAULT_SETTINGS.variantCount,
  lowQualityPreview: DEFAULT_SETTINGS.lowQualityPreview,
  transcriptionModel: DEFAULT_SETTINGS.transcriptionModel,
  panelLayout: DEFAULT_LAYOUT,
  loaded: false,
  load: async () => set({ ...(await readPrefs()), loaded: true }),
  update: async (patch) => {
    const seq = ++writes
    set(patch)
    const stored = await writePrefs(patch)
    // A newer change was made while this one was being written; its own write will settle the state.
    if (seq === writes) set(stored)
  },
}))
