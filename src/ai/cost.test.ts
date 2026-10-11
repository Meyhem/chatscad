// @vitest-environment node
import { computeCost, priceFor } from './cost'

it('prefers the cost the provider reported', () => {
  expect(computeCost({ inputTokens: 1000, outputTokens: 310, costUsd: 0.011 }, { inputPerMTok: 3, outputPerMTok: 15 })).toEqual({
    cost: 0.011,
    costSource: 'provider',
  })
})

it('falls back to the price table (USD per million tokens)', () => {
  const r = computeCost({ inputTokens: 2000, outputTokens: 1000 }, { inputPerMTok: 3, outputPerMTok: 15 })
  expect(r.costSource).toBe('price-table')
  expect(r.cost).toBeCloseTo(0.021, 10)
})

it('reports an unknown price as null', () => {
  expect(computeCost({ inputTokens: 5, outputTokens: 5 }, undefined)).toEqual({ cost: null, costSource: null })
})

describe('priceFor', () => {
  const base = { baseUrl: 'https://openrouter.ai/api/v1', priceTable: {}, cachedModels: [] }

  it('uses the editable price table first', () => {
    const profile = {
      ...base,
      priceTable: { m: { inputPerMTok: 1, outputPerMTok: 2 } },
      cachedModels: [{ id: 'm', price: { inputPerMTok: 9, outputPerMTok: 9 } }],
    }
    expect(priceFor(profile, 'm')).toEqual({ inputPerMTok: 1, outputPerMTok: 2 })
  })

  it('then the price the provider listed for the model', () => {
    const profile = { ...base, cachedModels: [{ id: 'm', price: { inputPerMTok: 3, outputPerMTok: 15 } }] }
    expect(priceFor(profile, 'm')).toEqual({ inputPerMTok: 3, outputPerMTok: 15 })
  })

  it('treats a server on this computer as free', () => {
    expect(priceFor({ ...base, baseUrl: 'http://localhost:11434/v1' }, 'qwen3-coder')).toEqual({ inputPerMTok: 0, outputPerMTok: 0 })
  })

  it('returns undefined when nothing is known', () => {
    expect(priceFor(base, 'mystery')).toBeUndefined()
  })
})
