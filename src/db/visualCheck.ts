import { computeCost } from '../ai/cost'
import type { Usage } from '../ai/types'
import { db, DEFAULT_SETTINGS, type ChatScadDb, type ProviderProfile, type UsageRecord } from './db'

export async function getVisualCheck(database: ChatScadDb = db): Promise<boolean> {
  return (await database.settings.get('app'))?.visualCheck ?? false
}

export async function setVisualCheck(on: boolean, database: ChatScadDb = db): Promise<void> {
  await database.transaction('rw', database.settings, async () => {
    const current = await database.settings.get('app')
    await database.settings.put({ ...DEFAULT_SETTINGS, ...current, id: 'app', visualCheck: on })
  })
}

export async function recordVisualCheckUsage(
  input: { profile: ProviderProfile; model: string; usage: Usage; projectId?: string | null },
  database: ChatScadDb = db,
): Promise<UsageRecord> {
  const { cost, costSource } = computeCost(input.usage, input.profile.priceTable[input.model])
  const record: UsageRecord = {
    id: crypto.randomUUID(),
    profileId: input.profile.id,
    model: input.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cost,
    costSource,
    createdAt: Date.now(),
    projectId: input.projectId ?? null,
    versionId: null,
  }
  await database.usage.add(record)
  return record
}
