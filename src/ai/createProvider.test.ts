// @vitest-environment node
import { newProfile } from '../db/profiles'
import { createProvider } from './createProvider'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(body: unknown) {
  const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json(body))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('uses the OpenAI-compatible adapter for openai-compatible profiles', async () => {
  const fetch = stubFetch({ data: [{ id: 'm1' }] })
  const provider = createProvider(newProfile({ name: 'x', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', apiKey: 'k' }))
  expect(await provider.listModels()).toEqual([{ id: 'm1' }])
  expect(String(fetch.mock.calls[0][0])).toBe('https://llm.test/v1/models')
})

it('uses the Anthropic adapter for anthropic profiles', async () => {
  const fetch = stubFetch({ data: [{ type: 'model', id: 'claude-a', display_name: 'Claude A', created_at: '2026-01-01T00:00:00Z' }], has_more: false })
  const provider = createProvider(newProfile({ name: 'x', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant' }))
  expect(await provider.listModels()).toEqual([{ id: 'claude-a', name: 'Claude A' }])
  expect(String(fetch.mock.calls[0][0])).toContain('https://api.anthropic.com/v1/models')
})

it('never throws while building a provider, even with no key', () => {
  expect(() => createProvider(newProfile({ name: 'x', adapter: 'anthropic', baseUrl: '' }))).not.toThrow()
})
