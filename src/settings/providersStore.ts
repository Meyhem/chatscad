import { create } from 'zustand'
import { createProvider } from '../ai/createProvider'
import { withEffort } from '../ai/effort'
import { isOpenRouter } from '../ai/url'
import type { ReasoningEffort } from '../ai/types'
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
  /** null goes back to Default. */
  setReasoningEffort(profileId: string, model: string, effort: ReasoningEffort | null): Promise<void>
  /** Reloads Anthropic and OpenRouter model lists cached before they carried limits and reasoning support. */
  refreshStaleModels(create?: typeof createProvider): Promise<void>
}

/** A list from a provider that reports limits or reasoning, cached before the app read them. */
const staleModels = (p: ProviderProfile) =>
  (p.adapter === 'anthropic' || isOpenRouter(p.baseUrl)) &&
  p.cachedModels.length > 0 &&
  !p.cachedModels.some((m) => m.reasoning !== undefined || m.maxOutputTokens !== undefined)

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

  // Not through updateProfile: an effort choice must not clear the profile's Test connection result.
  setReasoningEffort: async (profileId, model, effort) => {
    const current = get().profiles.find((p) => p.id === profileId)
    if (!current) return
    const next: ProviderProfile = { ...current, reasoningEffort: withEffort(current, model, effort), updatedAt: Date.now() }
    set((s) => ({ profiles: s.profiles.map((p) => (p.id === profileId ? next : p)) }))
    await saveProfile(next)
  },

  // Saves directly, like setReasoningEffort: a refreshed list must not clear the connection status.
  refreshStaleModels: async (create = createProvider) => {
    for (const stale of get().profiles.filter(staleModels)) {
      try {
        const models = await create(stale).listModels()
        const current = get().profiles.find((p) => p.id === stale.id)
        if (!current) continue
        const next: ProviderProfile = { ...current, cachedModels: models, updatedAt: Date.now() }
        set((s) => ({ profiles: s.profiles.map((p) => (p.id === next.id ? next : p)) }))
        await saveProfile(next)
      } catch {
        // Offline or locked: the old list still works; the next start tries again.
      }
    }
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
