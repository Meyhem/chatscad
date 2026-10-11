// @vitest-environment node
import { newProfile } from '../db/profiles'
import { LOCKED_MESSAGE } from '../security/lock'
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

it.each(['', 'api.openai.com/v1', '/v1', 'ftp://llm.test/v1'])(
  'sends nothing, and above all no key, when the base URL %j is not a full http(s) address',
  async (baseUrl) => {
    const fetch = stubFetch({ data: [] })
    for (const adapter of ['openai-compatible', 'anthropic'] as const) {
      const provider = createProvider(newProfile({ name: 'x', adapter, baseUrl, apiKey: 'secret-key' }))
      await expect(provider.listModels()).rejects.toMatchObject({ name: 'ProviderError', kind: 'bad-request' })
      const stream = provider.streamChat({ model: 'm', system: '', messages: [{ role: 'user', content: 'hi' }] })
      await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({ kind: 'bad-request' })
    }
    expect(fetch).not.toHaveBeenCalled()
  },
)

it('fails on use, not on creation, while an encrypted key is locked, and sends nothing', async () => {
  const fetch = stubFetch({ data: [] })
  const provider = createProvider(
    newProfile({ name: 'x', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', apiKey: 'ciphertext', keyEncrypted: true }),
  )
  await expect(provider.listModels()).rejects.toMatchObject({ kind: 'auth', message: LOCKED_MESSAGE })
  expect(fetch).not.toHaveBeenCalled()
})
