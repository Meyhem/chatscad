import type { ProviderProfile } from '../db/db'

export interface ReviewerChoice {
  profile: ProviderProfile
  model: string
}

export const NO_REVIEWER = 'Review needs a model that takes images. Turn on Vision for a provider in Settings › AI providers.'

/** The profile's Vision switch decides, unless the provider's model list says this model takes no images. */
export function modelTakesImages(profile: ProviderProfile, model: string): boolean {
  if (!profile.capabilities.vision || model.trim() === '') return false
  return profile.cachedModels.find((m) => m.id === model)?.capabilities?.vision !== false
}

export function selectReviewer(input: {
  profiles: ProviderProfile[]
  activeProfile: ProviderProfile | null
  activeModel: string | null
  reviewProfileId: string | null
  reviewModel: string | null
}): ReviewerChoice | null {
  const chosen = input.profiles.find((p) => p.id === input.reviewProfileId)
  if (chosen && input.reviewModel && modelTakesImages(chosen, input.reviewModel)) return { profile: chosen, model: input.reviewModel }
  if (input.activeProfile && input.activeModel && modelTakesImages(input.activeProfile, input.activeModel)) {
    return { profile: input.activeProfile, model: input.activeModel }
  }
  return null
}

const MAX_PER_PROFILE = 50

/** Every model a reviewer could be: the image models of each profile with Vision on, its default model first. */
export function reviewerChoices(profiles: ProviderProfile[]): ReviewerChoice[] {
  return profiles.flatMap((profile) => {
    if (!profile.capabilities.vision) return []
    const ids = [profile.defaultModel.trim(), ...profile.cachedModels.map((m) => m.id)].filter((id, i, all) => id !== '' && all.indexOf(id) === i)
    return ids.filter((id) => modelTakesImages(profile, id)).slice(0, MAX_PER_PROFILE).map((model) => ({ profile, model }))
  })
}
