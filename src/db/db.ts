import Dexie, { type Table } from 'dexie'
import type { AdapterKind, ModelInfo, ModelPrice, ProviderCapabilities } from '../ai/types'

export interface ProviderProfile {
  id: string
  name: string
  adapter: AdapterKind
  baseUrl: string
  apiKey: string // M3 lock mode stores ciphertext here and sets keyEncrypted
  keyEncrypted?: boolean // M3
  defaultModel: string
  cachedModels: ModelInfo[]
  capabilities: ProviderCapabilities
  priceTable: Record<string, ModelPrice> // model id → price, user-editable
  createdAt: number
  updatedAt: number
}

export interface UsageRecord {
  id: string
  profileId: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number | null
  costSource: 'provider' | 'price-table' | null
  createdAt: number
  projectId: string | null // null in M2; set from M3
  versionId: string | null // null in M2; set from M3
}

export interface Settings {
  id: 'app'
  activeProfileId: string | null
  activeModel: string | null
  autoFixAttempts: number // default 2
  // M3 adds: theme ('system' | 'dark' | 'light'), debounceMs (600), timeoutMs (60000),
  //          lastProjectId (string | null), lockMode (boolean)
  // M4 adds: variantCount (1 | 3), lowQualityPreview (boolean)
  // M5 adds: visualCheck (boolean)
}

export const DEFAULT_SETTINGS: Settings = { id: 'app', activeProfileId: null, activeModel: null, autoFixAttempts: 2 }

export class PromptCadDb extends Dexie {
  providerProfiles!: Table<ProviderProfile, string>
  usage!: Table<UsageRecord, string>
  settings!: Table<Settings, 'app'>
  // M3: projects, versions, messages, presets, blobs, printerProfiles

  constructor(name = 'promptcad') {
    super(name)
    this.version(1).stores({
      providerProfiles: 'id, name',
      usage: 'id, profileId, createdAt, projectId',
      settings: 'id',
    })
  }
}

/** Database name 'promptcad'. Tests use `fake-indexeddb` and `new PromptCadDb(uniqueName)`. */
export const db = new PromptCadDb()
