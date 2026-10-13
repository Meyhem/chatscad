// @vitest-environment node
import 'fake-indexeddb/auto'
import { ChatScadDb, type ProviderProfile } from '../db/db'
import { recordAgentUsage } from './usage'

let database: ChatScadDb
beforeEach(() => {
  database = new ChatScadDb(`agent-usage-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await database.delete()
})

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

it('records a plan or review call as a usage row of the project, priced from the profile', async () => {
  const row = await recordAgentUsage({ profile, model: 'm', usage: { inputTokens: 1000, outputTokens: 500 }, projectId: 'proj' }, database)
  expect(await database.usage.get(row.id)).toMatchObject({
    profileId: 'p1',
    model: 'm',
    inputTokens: 1000,
    outputTokens: 500,
    costSource: 'price-table',
    projectId: 'proj',
    versionId: null,
  })
  expect(row.cost).toBeCloseTo(0.002)
})
