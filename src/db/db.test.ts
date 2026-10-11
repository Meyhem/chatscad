// @vitest-environment node
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import type { ProviderProfile, UsageRecord } from './db'
import { DEFAULT_SETTINGS, PromptCadDb, V1_STORES } from './db'

const profile: ProviderProfile = {
  id: 'p1',
  name: 'OpenRouter',
  adapter: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-test',
  defaultModel: 'openai/gpt-5-mini',
  cachedModels: [{ id: 'openai/gpt-5-mini' }],
  capabilities: { streaming: true, vision: false, audio: false },
  priceTable: {},
  createdAt: 1,
  updatedAt: 2,
}

const usage: UsageRecord = {
  id: 'u1',
  profileId: 'p1',
  model: 'openai/gpt-5-mini',
  inputTokens: 1000,
  outputTokens: 180,
  cost: 0.006,
  costSource: 'provider',
  createdAt: 3,
  projectId: null,
  versionId: null,
}

it('upgrades a version 1 database to version 2 without losing profiles, usage or settings', async () => {
  const name = `upgrade-${crypto.randomUUID()}`
  const v1 = new Dexie(name)
  v1.version(1).stores(V1_STORES)
  await v1.open()
  await v1.table('providerProfiles').add(profile)
  await v1.table('usage').add(usage)
  await v1.table('settings').add({ id: 'app', activeProfileId: 'p1', activeModel: 'openai/gpt-5-mini', autoFixAttempts: 3 })
  v1.close()

  const v2 = new PromptCadDb(name)
  await v2.open()
  expect(v2.verno).toBe(2)
  expect(await v2.providerProfiles.get('p1')).toEqual(profile)
  expect(await v2.usage.toArray()).toEqual([usage])
  expect(await v2.settings.get('app')).toEqual({
    ...DEFAULT_SETTINGS,
    activeProfileId: 'p1',
    activeModel: 'openai/gpt-5-mini',
    autoFixAttempts: 3,
  })
  expect(v2.tables.map((t) => t.name).sort()).toEqual([
    'blobs', 'messages', 'presets', 'printerProfiles', 'projects', 'providerProfiles', 'settings', 'usage', 'versions',
  ])
  expect(await v2.usage.where('versionId').equals('nope').count()).toBe(0)
  v2.close()
  await Dexie.delete(name)
})

it('creates a fresh database at version 2 with M3 settings defaults', () => {
  expect(DEFAULT_SETTINGS).toEqual({
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
    variantCount: 1,
    lowQualityPreview: false,
    transcriptionModel: 'whisper-1',
  })
})
