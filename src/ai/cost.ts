import type { ModelInfo, ModelPrice, Usage } from './types'
import { isLocalBaseUrl } from './url'

export function computeCost(
  usage: Usage,
  price: ModelPrice | undefined,
): { cost: number | null; costSource: 'provider' | 'price-table' | null } {
  if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) return { cost: usage.costUsd, costSource: 'provider' }
  if (price) {
    return {
      cost: (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000,
      costSource: 'price-table',
    }
  }
  return { cost: null, costSource: null }
}

export interface PricedProfile {
  baseUrl: string
  priceTable: Record<string, ModelPrice>
  cachedModels: ModelInfo[]
}

const FREE: ModelPrice = { inputPerMTok: 0, outputPerMTok: 0 }

/** The user's price table wins, then the provider's listed price; a server on this computer costs nothing. */
export function priceFor(profile: PricedProfile, model: string): ModelPrice | undefined {
  return (
    profile.priceTable[model] ??
    profile.cachedModels.find((m) => m.id === model)?.price ??
    (isLocalBaseUrl(profile.baseUrl) ? FREE : undefined)
  )
}
