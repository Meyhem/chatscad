import type { ChatRequest, LlmProvider } from '../ai/types'
import { variantTemperatures, withTemperature } from './temperatures'

async function drain(events: AsyncIterable<unknown>) {
  for await (const e of events) void e
}

it('keeps A at the default and samples B and C hotter, except on Anthropic', () => {
  expect(variantTemperatures('openai-compatible', 3)).toEqual([undefined, 0.7, 1.0])
  expect(variantTemperatures('anthropic', 3)).toEqual([undefined, undefined, undefined])
  expect(variantTemperatures('openai-compatible', 1)).toEqual([undefined])
})

it('sets the temperature on every request that has none', async () => {
  const seen: ChatRequest[] = []
  const base: LlmProvider = {
    listModels: vi.fn(async () => []),
    async *streamChat(req) {
      seen.push(req)
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
    },
  }
  const hot = withTemperature(base, 0.7)
  await drain(hot.streamChat({ model: 'm', system: 's', messages: [] }))
  await drain(hot.streamChat({ model: 'm', system: 's', messages: [], temperature: 0.2 }))
  expect(seen.map((r) => r.temperature)).toEqual([0.7, 0.2])
  await hot.listModels()
  expect(base.listModels).toHaveBeenCalled()
  expect(withTemperature(base, undefined)).toBe(base)
})
