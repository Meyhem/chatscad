import { describeProviderError } from './errors'
import { ProviderError } from './types'

const network = new ProviderError('network', "Couldn't reach http://localhost:11434/v1/models: Failed to fetch")

it('explains an Ollama CORS block with the OLLAMA_ORIGINS command for this site', () => {
  const d = describeProviderError(network, 'http://localhost:11434/v1')
  expect(d.title).toBe('Ollama blocked the request from this page (CORS)')
  expect(d.body).toContain(`OLLAMA_ORIGINS=${location.origin} ollama serve`)
})

it('explains an LM Studio CORS block', () => {
  expect(describeProviderError(network, 'http://127.0.0.1:1234/v1').title).toBe('LM Studio blocked the request from this page (CORS)')
})

it('explains other local servers and remote hosts', () => {
  expect(describeProviderError(network, 'http://localhost:8080/v1')).toEqual({
    title: "Couldn't reach localhost:8080",
    body: `Check that the server on localhost:8080 is running and allows requests from ${location.origin} (CORS).`,
  })
  const remote = describeProviderError(network, 'https://api.example.com/v1')
  expect(remote.title).toBe("Couldn't reach api.example.com")
  expect(remote.body).toContain('CORS')
})

it('names the host that rejected the key and says where to fix it', () => {
  expect(describeProviderError(new ProviderError('auth', 'Incorrect API key provided', 401), 'https://api.openai.com/v1')).toEqual({
    title: 'api.openai.com rejected the API key',
    body: 'Incorrect API key provided. Check the key in Settings › AI providers.',
  })
})

it('tells an unknown model apart from other bad requests', () => {
  expect(describeProviderError(new ProviderError('not-found', 'The model `gpt-9` does not exist', 404), 'https://api.openai.com/v1').title).toBe(
    "api.openai.com doesn't know this model or address",
  )
  expect(describeProviderError(new ProviderError('bad-request', 'foo/bar is not a valid model ID', 400), 'https://openrouter.ai/api/v1').title).toBe(
    "openrouter.ai doesn't know this model",
  )
  expect(describeProviderError(new ProviderError('bad-request', 'messages: too long', 400), 'https://openrouter.ai/api/v1')).toEqual({
    title: 'openrouter.ai rejected the request',
    body: 'messages: too long.',
  })
})

it('covers rate limits, server errors and stops', () => {
  expect(describeProviderError(new ProviderError('rate-limit', 'Slow down', 429), 'https://api.anthropic.com').body).toBe(
    "Slow down. Wait a minute and try again, or check your plan's limits.",
  )
  expect(describeProviderError(new ProviderError('server', 'Overloaded', 529), 'https://api.anthropic.com').title).toBe(
    'api.anthropic.com had a server error',
  )
  expect(describeProviderError(new ProviderError('aborted', 'x'), 'https://api.anthropic.com').title).toBe('Stopped')
})

it('handles errors that are not provider errors', () => {
  expect(describeProviderError(new Error('boom'), 'https://llm.test/v1')).toEqual({
    title: 'Something went wrong talking to llm.test',
    body: 'boom.',
  })
})

it('asks for a full address when the base URL is not one', () => {
  const err = new ProviderError('bad-request', 'The base URL is not a full http(s) address')
  for (const baseUrl of ['', 'api.openai.com/v1']) {
    expect(describeProviderError(err, baseUrl)).toEqual({
      title: 'The base URL is not a full address',
      body: 'Enter it with http:// or https:// at the start, for example https://api.openai.com/v1, or http://localhost:11434/v1 for Ollama on this computer.',
    })
  }
})
