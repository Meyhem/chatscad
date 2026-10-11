// @vitest-environment node
import 'fake-indexeddb/auto'
import { DEFAULT_SETTINGS, ChatScadDb, type ProviderProfile } from './db'
import { getVisualCheck, recordVisualCheckUsage, setVisualCheck } from './visualCheck'

let database: ChatScadDb
beforeEach(() => {
  database = new ChatScadDb(`visual-check-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await database.delete()
})

it('is off by default, including for settings saved before M5', async () => {
  expect(DEFAULT_SETTINGS.visualCheck).toBe(false)
  expect(await getVisualCheck(database)).toBe(false)
  const older = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).filter(([key]) => key !== 'visualCheck'))
  await database.settings.put(older as typeof DEFAULT_SETTINGS)
  expect(await getVisualCheck(database)).toBe(false)
})

it('turns on and off without touching other settings', async () => {
  await database.settings.put({ ...DEFAULT_SETTINGS, activeProfileId: 'p1' })
  await setVisualCheck(true, database)
  expect(await getVisualCheck(database)).toBe(true)
  expect((await database.settings.get('app'))?.activeProfileId).toBe('p1')
  await setVisualCheck(false, database)
  expect(await getVisualCheck(database)).toBe(false)
})

it('records the check as a usage row priced from the profile', async () => {
  const profile: ProviderProfile = {
    id: 'p1',
    name: 'Test',
    adapter: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    defaultModel: 'm',
    cachedModels: [],
    capabilities: { streaming: true, vision: true, audio: false },
    priceTable: { m: { inputPerMTok: 1, outputPerMTok: 2 } },
    createdAt: 0,
    updatedAt: 0,
  }
  const row = await recordVisualCheckUsage({ profile, model: 'm', usage: { inputTokens: 1000, outputTokens: 500 } }, database)
  expect(await database.usage.get(row.id)).toMatchObject({ profileId: 'p1', model: 'm', inputTokens: 1000, outputTokens: 500, costSource: 'price-table' })
  expect(row.cost).toBeCloseTo(0.002)
})
