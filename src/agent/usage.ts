import { computeCost, priceFor } from '../ai/cost'
import type { Usage } from '../ai/types'
import { db, type ChatScadDb, type ProviderProfile, type UsageRecord } from '../db/db'

/** Plan and review calls are not chat turns; they are recorded against the project, not a version. */
export async function recordAgentUsage(
  input: { profile: ProviderProfile; model: string; usage: Usage; projectId: string | null },
  database: ChatScadDb = db,
): Promise<UsageRecord> {
  const { cost, costSource } = computeCost(input.usage, priceFor(input.profile, input.model))
  const record: UsageRecord = {
    id: crypto.randomUUID(),
    profileId: input.profile.id,
    model: input.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cost,
    costSource,
    createdAt: Date.now(),
    projectId: input.projectId,
    versionId: null,
  }
  await database.usage.add(record)
  return record
}
