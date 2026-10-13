import { scriptedProvider } from '../test/providers'
import { askForJson, extractJson } from './llm'

it('finds JSON in a fence, after prose, or as the whole reply', () => {
  expect(extractJson('{"a": 1}')).toEqual({ a: 1 })
  expect(extractJson('Here you go:\n```json\n{"a": 2}\n```\nDone.')).toEqual({ a: 2 })
  expect(extractJson('Sure. {"a": {"b": "}"}} trailing')).toEqual({ a: { b: '}' } })
})

it('says what is wrong when there is no JSON object', () => {
  expect(() => extractJson('No idea.')).toThrow('The reply had no JSON object')
  expect(() => extractJson('{"a": }')).toThrow('The reply had no JSON object')
  expect(() => extractJson('[1, 2]')).toThrow('The reply had no JSON object')
})

it('asks once more for JSON only when the first reply cannot be read, and adds up the usage', async () => {
  const { provider, requests } = scriptedProvider(
    { text: 'Let me think.', usage: { inputTokens: 100, outputTokens: 10 } },
    { text: '{"ok": true}', usage: { inputTokens: 120, outputTokens: 5 } },
  )
  const result = await askForJson({ provider, model: 'm', system: 'S', content: 'Q', parse: (v) => v as { ok: boolean } })
  expect(result.value).toEqual({ ok: true })
  expect(result.usage).toEqual({ inputTokens: 220, outputTokens: 15 })
  expect(requests).toHaveLength(2)
  expect(requests[1].messages.at(-1)).toEqual({ role: 'user', content: 'Reply with the JSON object only, no other text.' })
  expect(requests[1].messages.at(-2)).toEqual({ role: 'assistant', content: 'Let me think.' })
})

it('gives up after the second unreadable reply with the reason', async () => {
  const { provider } = scriptedProvider('nope', 'still nope')
  await expect(askForJson({ provider, model: 'm', system: 'S', content: 'Q', parse: (v) => v })).rejects.toThrow('The reply had no JSON object')
})

it('passes a parse error through the retry too', async () => {
  const { provider } = scriptedProvider('{"x": 1}', '{"x": 2}')
  const parse = () => {
    throw new Error('The plan had no checks')
  }
  await expect(askForJson({ provider, model: 'm', system: 'S', content: 'Q', parse })).rejects.toThrow('The plan had no checks')
})
