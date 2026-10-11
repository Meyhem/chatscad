import { db, type UsageRecord } from './db'

export type NewUsage = Omit<UsageRecord, 'id' | 'createdAt' | 'projectId' | 'versionId'>

export async function addUsage(input: NewUsage): Promise<UsageRecord> {
  const record: UsageRecord = { ...input, id: crypto.randomUUID(), createdAt: Date.now(), projectId: null, versionId: null }
  await db.usage.add(record)
  return record
}

export interface UsageTotal {
  cost: number
  tokens: number
  /** Rows whose cost is unknown (no provider cost and no price). */
  unpriced: number
}

export async function monthTotals(now = Date.now()): Promise<Map<string, UsageTotal>> {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const rows = await db.usage.where('createdAt').aboveOrEqual(start).toArray()
  const totals = new Map<string, UsageTotal>()
  for (const r of rows) {
    const t = totals.get(r.profileId) ?? { cost: 0, tokens: 0, unpriced: 0 }
    t.tokens += r.inputTokens + r.outputTokens
    if (r.cost === null) t.unpriced += 1
    else t.cost += r.cost
    totals.set(r.profileId, t)
  }
  return totals
}
