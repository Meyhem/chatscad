import { create } from 'zustand'
import { DEFAULT_SETTINGS, type ProviderProfile, type Settings } from '../db/db'
import { deleteProfile, listProfiles, newProfile, saveProfile } from '../db/profiles'
import { getSettings, updateSettings } from '../db/settings'
import { onLockChange } from '../security/lock'
import type { ProviderPreset } from './presets'

export type ConnectionStatus = 'ok' | 'blocked' | 'failed'
export type ProfilePatch = Partial<Omit<ProviderProfile, 'id' | 'createdAt' | 'updatedAt'>>

export interface ProvidersState {
  loaded: boolean
  profiles: ProviderProfile[]
  settings: Settings
  /** Result of the last Test connection per profile, this session only. */
  status: Record<string, ConnectionStatus>
  load(): Promise<void>
  addProfile(preset: ProviderPreset): Promise<ProviderProfile>
  updateProfile(id: string, patch: ProfilePatch): Promise<void>
  removeProfile(id: string): Promise<void>
  setStatus(id: string, status: ConnectionStatus): void
  chooseModel(profileId: string, model: string): Promise<void>
}

function without(status: Record<string, ConnectionStatus>, id: string): Record<string, ConnectionStatus> {
  const next = { ...status }
  delete next[id]
  return next
}

export const useProvidersStore = create<ProvidersState>()((set, get) => ({
  loaded: false,
  profiles: [],
  settings: DEFAULT_SETTINGS,
  status: {},

  load: async () => {
    try {
      const [profiles, settings] = await Promise.all([listProfiles(), getSettings()])
      set({ profiles, settings, loaded: true })
    } catch {
      // No IndexedDB (some private windows): the app still works by hand, just without saved providers.
      set({ loaded: true })
    }
  },

  addProfile: async (preset) => {
    const profile = await saveProfile(newProfile({ name: preset.name, adapter: preset.adapter, baseUrl: preset.baseUrl }))
    set((s) => ({ profiles: [...s.profiles, profile] }))
    if (get().settings.activeProfileId === null) {
      set({ settings: await updateSettings({ activeProfileId: profile.id, activeModel: null }) })
    }
    return profile
  },

  updateProfile: async (id, patch) => {
    const current = get().profiles.find((p) => p.id === id)
    if (!current) return
    const next: ProviderProfile = { ...current, ...patch, updatedAt: Date.now() }
    set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? next : p)), status: without(s.status, id) }))
    try {
      await saveProfile(next)
    } catch {
      // A key cannot be changed while the keys are locked; show what is actually stored.
      await get().load()
    }
  },

  removeProfile: async (id) => {
    await deleteProfile(id)
    const settings = await getSettings()
    set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id), settings, status: without(s.status, id) }))
  },

  setStatus: (id, status) => set((s) => ({ status: { ...s.status, [id]: status } })),

  chooseModel: async (profileId, model) => {
    set((s) => ({ settings: { ...s.settings, activeProfileId: profileId, activeModel: model } }))
    await updateSettings({ activeProfileId: profileId, activeModel: model })
  },
}))

export function selectActiveProfile(s: Pick<ProvidersState, 'profiles' | 'settings'>): ProviderProfile | null {
  return s.profiles.find((p) => p.id === s.settings.activeProfileId) ?? s.profiles[0] ?? null
}

export function selectActiveModel(s: Pick<ProvidersState, 'profiles' | 'settings'>): string | null {
  const profile = selectActiveProfile(s)
  if (!profile) return null
  if (s.settings.activeProfileId === profile.id && s.settings.activeModel) return s.settings.activeModel
  return profile.defaultModel.trim() || null
}

// Lock, unlock and lock-mode changes rewrite the stored profiles; reload so this tab never keeps a plaintext copy.
onLockChange(() => void useProvidersStore.getState().load())
