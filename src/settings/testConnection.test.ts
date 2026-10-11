import { ProviderError, type LlmProvider } from '../ai/types'
import { scriptedProvider } from '../test/providers'
import { testConnection } from './testConnection'

function failing(listError: Error | null, chatError: Error | null = null): LlmProvider {
  return {
    listModels: async () => {
      if (listError) throw listError
      return [{ id: 'm1' }, { id: 'm2' }]
    },
    async *streamChat() {
      if (chatError) throw chatError
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' }
    },
  }
}

it('lists the models and sends a tiny request to the default model', async () => {
  const { provider, requests, models } = scriptedProvider('OK')
  models.push({ id: 'llama3' }, { id: 'qwen3-coder' })
  expect(await testConnection(provider, 'qwen3-coder', 'http://localhost:11434/v1')).toEqual({
    ok: true,
    models: [{ id: 'llama3' }, { id: 'qwen3-coder' }],
    title: 'Connection works',
    body: 'qwen3-coder on localhost:11434 replied · 2 models listed.',
  })
  expect(requests[0]).toMatchObject({ model: 'qwen3-coder', maxTokens: 16, messages: [{ role: 'user', content: 'Say OK.' }] })
})

it('reports a CORS block from the model list in plain words, with kind network', async () => {
  const r = await testConnection(failing(new ProviderError('network', 'Failed to fetch')), 'llama3', 'http://localhost:11434/v1')
  expect(r).toMatchObject({ ok: false, kind: 'network', title: 'Ollama blocked the request from this page (CORS)', models: null })
})

it('treats a missing model list as fine and still tests the model', async () => {
  const r = await testConnection(failing(new ProviderError('not-found', 'Not Found', 404)), 'm', 'https://llm.test/v1')
  expect(r).toEqual({ ok: true, models: null, title: 'Connection works', body: 'm on llm.test replied.' })
})

it('reports an unknown model from the chat request', async () => {
  const r = await testConnection(
    failing(null, new ProviderError('not-found', 'The model `gpt-9` does not exist', 404)),
    'gpt-9',
    'https://api.openai.com/v1',
  )
  expect(r).toMatchObject({ ok: false, kind: 'not-found', models: [{ id: 'm1' }, { id: 'm2' }] })
  expect(r.title).toBe("api.openai.com doesn't know this model or address")
})

it('without a default model, succeeds when models are listed and asks for one otherwise', async () => {
  expect(await testConnection(failing(null), ' ', 'https://openrouter.ai/api/v1')).toMatchObject({
    ok: true,
    body: 'openrouter.ai answered · 2 models listed. Pick a default model to finish.',
  })
  expect(await testConnection(failing(new ProviderError('not-found', 'x', 404)), '', 'https://llm.test/v1')).toEqual({
    ok: false,
    models: null,
    kind: null,
    title: 'Set a default model',
    body: "llm.test doesn't list its models. Type the model name in Default model, then test again.",
  })
})
