import Dexie, { type Table } from 'dexie'
import type { AdapterKind, ModelInfo, ModelPrice, ProviderCapabilities } from '../ai/types'
import type { ParamValue } from '../render/types'

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

export type ThemeSetting = 'system' | 'dark' | 'light'

export interface Settings {
  id: 'app'
  activeProfileId: string | null
  activeModel: string | null
  autoFixAttempts: number // default 2
  // M3
  theme: ThemeSetting
  debounceMs: number
  timeoutMs: number
  lastProjectId: string | null
  lockMode: boolean
  /** Base64 of the random 16-byte PBKDF2 salt while lock mode is on. */
  lockSalt: string | null
  /** Base64 AES-GCM ciphertext of a fixed text; decrypting it checks the passphrase. */
  lockVerifier: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  activeProfileId: null,
  activeModel: null,
  autoFixAttempts: 2,
  theme: 'system',
  debounceMs: 600,
  timeoutMs: 60_000,
  lastProjectId: null,
  lockMode: false,
  lockSalt: null,
  lockVerifier: null,
}

export type VersionSource = 'ai' | 'manual' | 'slider' | 'autofix' | 'restore' | 'gallery' | 'import'

export interface Project {
  id: string; name: string; createdAt: number; updatedAt: number
  headVersionId: string | null
  providerProfileId: string | null
  enabledLibraries: string[] // 'BOSL2' | 'MCAD'
  origin: 'blank' | 'gallery' | 'shared-link'
}

export interface Version {
  id: string; projectId: string; parentId: string | null
  code: string
  params: Record<string, ParamValue>
  source: VersionSource
  kind: 'main' | 'variant'
  variantGroupId: string | null
  label: string // "v3", "v3.1" — computed on create, stable afterwards
  message: string // prompt, "height 18 → 22", "Auto-fix: …"
  model: string | null
  compileStatus: 'ok' | 'error' | 'pending'
  renderMs: number | null
  thumbnailBlobId: string | null
  createdAt: number
}

export interface StoredMessage {
  id: string; projectId: string; versionId: string | null
  role: 'user' | 'assistant' | 'note'
  content: string
  imageBlobIds: string[] // used from M5
  audioTranscript: string | null // used from M4
  model: string | null
  usageId: string | null
  createdAt: number
}

export interface Preset { id: string; projectId: string; name: string; params: Record<string, ParamValue> }
export interface StoredBlob { id: string; kind: 'thumbnail' | 'image' | 'stl'; data: Blob }
/** Reserved for future printing features (spec "Future: 3D printing hooks"). */
export interface PrinterProfile { id: string }

export const V1_STORES = { providerProfiles: 'id, name', usage: 'id, profileId, createdAt, projectId', settings: 'id' }
export const V2_STORES = {
  usage: 'id, profileId, createdAt, projectId, versionId',
  projects: 'id, updatedAt',
  versions: 'id, projectId, parentId, createdAt',
  messages: 'id, projectId, versionId, createdAt',
  presets: 'id, projectId',
  blobs: 'id',
  printerProfiles: 'id',
}

/** Adds any settings field the row lacks, from DEFAULT_SETTINGS. Used by the v2 upgrade. */
export function fillSettingsDefaults(row: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) if (!(key in row)) row[key] = value
}

export class PromptCadDb extends Dexie {
  providerProfiles!: Table<ProviderProfile, string>
  usage!: Table<UsageRecord, string>
  settings!: Table<Settings, 'app'>
  projects!: Table<Project, string>
  versions!: Table<Version, string>
  messages!: Table<StoredMessage, string>
  presets!: Table<Preset, string>
  blobs!: Table<StoredBlob, string>
  printerProfiles!: Table<PrinterProfile, string>

  constructor(name = 'promptcad') {
    super(name)
    this.version(1).stores(V1_STORES)
    this.version(2)
      .stores(V2_STORES)
      .upgrade((tx) =>
        tx
          .table('settings')
          .toCollection()
          .modify((row: Record<string, unknown>) => fillSettingsDefaults(row)),
      )
  }
}

/** Database name 'promptcad'. Tests use `fake-indexeddb` and `new PromptCadDb(uniqueName)` or `resetDb()`. */
export const db = new PromptCadDb()
