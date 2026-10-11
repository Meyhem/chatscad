import type { ProviderProfile } from '../db/db'
import type { ReasoningEffort } from './types'

/** The effort chosen for this profile and model; undefined is Default (send nothing). */
export function effortFor(profile: ProviderProfile, model: string): ReasoningEffort | undefined {
  return profile.reasoningEffort?.[model]
}

/** What the model accepts, from the cached model list. Unknown counts as no. */
export function reasoningSupport(profile: ProviderProfile, model: string): { efforts: boolean; canDisable: boolean } {
  const r = profile.cachedModels.find((m) => m.id === model)?.reasoning
  return { efforts: r?.efforts ?? false, canDisable: r?.canDisable ?? false }
}

export function withEffort(profile: ProviderProfile, model: string, effort: ReasoningEffort | null): Record<string, ReasoningEffort> {
  const next = { ...profile.reasoningEffort }
  if (effort === null) delete next[model]
  else next[model] = effort
  return next
}
