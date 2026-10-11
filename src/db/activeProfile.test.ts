// @vitest-environment node
import 'fake-indexeddb/auto'
import { getActiveProfile } from './activeProfile'
import { DEFAULT_SETTINGS, PromptCadDb, type ProviderProfile } from './db'

const profile = (id: string, vision: boolean): ProviderProfile => ({
  id,
  name: id,
  adapter: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  defaultModel: 'm',
  cachedModels: [],
  capabilities: { streaming: true, vision, audio: false },
  priceTable: {},
  createdAt: 0,
  updatedAt: 0,
})

let database: PromptCadDb
beforeEach(() => {
  database = new PromptCadDb(`active-profile-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await database.delete()
})

it('returns null without settings or without an active profile', async () => {
  expect(await getActiveProfile(database)).toBeNull()
  await database.settings.put({ ...DEFAULT_SETTINGS })
  expect(await getActiveProfile(database)).toBeNull()
})

it('returns the active profile', async () => {
  await database.providerProfiles.bulkPut([profile('a', false), profile('b', true)])
  await database.settings.put({ ...DEFAULT_SETTINGS, activeProfileId: 'b' })
  expect((await getActiveProfile(database))?.capabilities.vision).toBe(true)
})

it('returns null when the active profile no longer exists', async () => {
  await database.settings.put({ ...DEFAULT_SETTINGS, activeProfileId: 'gone' })
  expect(await getActiveProfile(database)).toBeNull()
})
