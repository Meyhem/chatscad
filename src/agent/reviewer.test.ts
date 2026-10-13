import type { ProviderProfile } from '../db/db'
import { modelTakesImages, NO_REVIEWER, reviewerChoices, selectReviewer } from './reviewer'

function profile(id: string, vision: boolean, models: Array<{ id: string; vision?: boolean }>, defaultModel = models[0]?.id ?? ''): ProviderProfile {
  return {
    id,
    name: `Profile ${id}`,
    adapter: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    apiKey: 'k',
    defaultModel,
    cachedModels: models.map((m) => ({ id: m.id, ...(m.vision === undefined ? {} : { capabilities: { vision: m.vision, audio: false } }) })),
    capabilities: { streaming: true, vision, audio: false },
    priceTable: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

const seeing = profile('a', true, [{ id: 'gpt-5', vision: true }, { id: 'text-only', vision: false }, { id: 'unknown' }])
const blind = profile('b', false, [{ id: 'coder' }])

it('trusts the profile switch unless the provider says the model takes no images', () => {
  expect(modelTakesImages(seeing, 'gpt-5')).toBe(true)
  expect(modelTakesImages(seeing, 'unknown')).toBe(true)
  expect(modelTakesImages(seeing, 'text-only')).toBe(false)
  expect(modelTakesImages(blind, 'coder')).toBe(false)
})

it('uses the chosen reviewer when it takes images', () => {
  const choice = selectReviewer({ profiles: [seeing, blind], activeProfile: blind, activeModel: 'coder', reviewProfileId: 'a', reviewModel: 'gpt-5' })
  expect(choice).toEqual({ profile: seeing, model: 'gpt-5' })
})

it('falls back to the builder model when no reviewer is chosen and it takes images', () => {
  expect(selectReviewer({ profiles: [seeing], activeProfile: seeing, activeModel: 'unknown', reviewProfileId: null, reviewModel: null })).toEqual({
    profile: seeing,
    model: 'unknown',
  })
})

it('has no reviewer when neither the choice nor the builder takes images', () => {
  expect(selectReviewer({ profiles: [seeing, blind], activeProfile: blind, activeModel: 'coder', reviewProfileId: 'a', reviewModel: 'text-only' })).toBeNull()
  expect(selectReviewer({ profiles: [], activeProfile: null, activeModel: null, reviewProfileId: null, reviewModel: null })).toBeNull()
  expect(NO_REVIEWER).toBe('Review needs a model that takes images. Turn on Vision for a provider in Settings › AI providers.')
})

it('lists the image models of each vision profile, with the default model first', () => {
  const choices = reviewerChoices([seeing, blind, profile('c', true, [], 'llava')])
  expect(choices.map((c) => `${c.profile.id}:${c.model}`)).toEqual(['a:gpt-5', 'a:unknown', 'c:llava'])
})
