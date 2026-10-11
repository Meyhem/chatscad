import 'fake-indexeddb/auto'
import { ChatScadDb } from '../db/db'
import { recordUsage } from './recordUsage'

it('writes one usage row with an id and a timestamp', async () => {
  const database = new ChatScadDb(`usage-${crypto.randomUUID()}`)
  const before = Date.now()
  await recordUsage(
    {
      profileId: 'profile-1',
      model: 'fake-model',
      inputTokens: 1_000,
      outputTokens: 500,
      cost: 0.002,
      costSource: 'price-table',
      projectId: 'project-1',
      versionId: null,
    },
    database,
  )
  const rows = await database.usage.toArray()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ profileId: 'profile-1', inputTokens: 1_000, cost: 0.002, projectId: 'project-1' })
  expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
  expect(rows[0].createdAt).toBeGreaterThanOrEqual(before)
  await database.delete()
})
