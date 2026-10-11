import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '../db/db'
import { getSettings, updateSettings } from '../db/settings'

export interface SettingsState {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Omit<Settings, 'id'>>): Promise<void>
}

/** In-memory mirror of the settings row, so components and the render loop can subscribe to it. */
export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => set({ settings: await getSettings(), loaded: true }),
  update: async (patch) => set({ settings: await updateSettings(patch) }),
}))
