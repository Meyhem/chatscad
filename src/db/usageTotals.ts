import { db } from './db'

export interface UsageTotal {
  tokens: number
  cost: number
  unpriced: number
}

export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function startOfMonth(now: number): number {
  const d = new Date(startOfDay(now))
  d.setDate(1)
  return d.getTime()
}

export async function usageTotalsSince(since: number): Promise<Map<string, UsageTotal>> {
  const totals = new Map<string, UsageTotal>()
  for (const u of await db.usage.where('createdAt').aboveOrEqual(since).toArray()) {
    const t = totals.get(u.profileId) ?? { tokens: 0, cost: 0, unpriced: 0 }
    t.tokens += u.inputTokens + u.outputTokens
    if (u.cost === null) t.unpriced++
    else t.cost += u.cost
    totals.set(u.profileId, t)
  }
  return totals
}
