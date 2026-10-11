import { resetDb } from '../test/db'
import { db } from './db'
import { addUsage, monthTotals } from './usage'

beforeEach(resetDb)

const row = { profileId: 'p1', model: 'm', inputTokens: 1000, outputTokens: 310, cost: 0.011, costSource: 'provider' as const }

it('stores a usage row with id, timestamp and no project yet', async () => {
  const rec = await addUsage(row)
  expect(rec).toMatchObject({ ...row, projectId: null, versionId: null })
  expect(await db.usage.get(rec.id)).toEqual(rec)
})

it('totals this month per profile, counting rows without a price separately', async () => {
  await addUsage(row)
  await addUsage({ ...row, cost: 0.004 })
  await addUsage({ ...row, profileId: 'p2', cost: null, costSource: null })
  const lastMonth = new Date()
  lastMonth.setMonth(lastMonth.getMonth() - 1)
  await db.usage.add({ ...row, id: 'old', createdAt: lastMonth.getTime(), projectId: null, versionId: null, cost: 5 })

  const totals = await monthTotals()
  expect(totals.get('p1')?.cost).toBeCloseTo(0.015, 10)
  expect(totals.get('p1')).toMatchObject({ tokens: 2620, unpriced: 0 })
  expect(totals.get('p2')).toEqual({ cost: 0, tokens: 1310, unpriced: 1 })
})
