import { newProfile } from '../db/profiles'
import { effortFor, reasoningSupport, withEffort } from './effort'

const base = newProfile({ name: 'OR', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'r1' })
const profile = {
  ...base,
  cachedModels: [{ id: 'r1', reasoning: { efforts: true, canDisable: false, adaptive: false } }, { id: 'plain' }],
  reasoningEffort: { r1: 'high' as const },
}

it('reads the stored effort per model', () => {
  expect(effortFor(profile, 'r1')).toBe('high')
  expect(effortFor(profile, 'plain')).toBeUndefined()
  expect(effortFor(base, 'r1')).toBeUndefined()
})

it('reports what the model supports, unknown counting as no', () => {
  expect(reasoningSupport(profile, 'r1')).toEqual({ efforts: true, canDisable: false })
  expect(reasoningSupport(profile, 'plain')).toEqual({ efforts: false, canDisable: false })
  expect(reasoningSupport(profile, 'typed-in')).toEqual({ efforts: false, canDisable: false })
})

it('sets and clears a choice without touching other models', () => {
  expect(withEffort(profile, 'plain', 'low')).toEqual({ r1: 'high', plain: 'low' })
  expect(withEffort(profile, 'r1', null)).toEqual({})
})
