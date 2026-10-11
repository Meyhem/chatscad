// @vitest-environment node
import 'fake-indexeddb/auto'
import { resetDb } from '../test/resetDb'
import { db, type UsageRecord } from './db'
import { startOfDay, startOfMonth, usageTotalsSince } from './usageTotals'

const row = (profileId: string, createdAt: number, cost: number | null, tokens = 100): UsageRecord => ({
  id: crypto.randomUUID(), profileId, model: 'm', inputTokens: tokens, outputTokens: 0, cost,
  costSource: cost === null ? null : 'provider', createdAt, projectId: null, versionId: null,
})

beforeEach(resetDb)

it('adds up tokens and known costs per profile since a time, counting unpriced calls', async () => {
  await db.usage.bulkAdd([row('a', 10, 0.01), row('a', 20, null, 50), row('b', 30, 0.5), row('a', 5, 9)])
  const totals = await usageTotalsSince(10)
  expect(totals.get('a')).toEqual({ tokens: 150, cost: 0.01, unpriced: 1 })
  expect(totals.get('b')).toEqual({ tokens: 100, cost: 0.5, unpriced: 0 })
})

it('finds the start of the local day and month', () => {
  const t = new Date(2026, 9, 11, 15, 30).getTime()
  expect(startOfDay(t)).toBe(new Date(2026, 9, 11).getTime())
  expect(startOfMonth(t)).toBe(new Date(2026, 9, 1).getTime())
})
