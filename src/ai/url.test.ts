// @vitest-environment node
import { hostOf, isHttpUrl, isLocalBaseUrl, joinUrl, portOf } from './url'

it('joins a base URL and a path with exactly one slash', () => {
  expect(joinUrl('https://api.openai.com/v1', 'models')).toBe('https://api.openai.com/v1/models')
  expect(joinUrl('https://api.openai.com/v1//', '/chat/completions')).toBe('https://api.openai.com/v1/chat/completions')
  expect(joinUrl('  http://localhost:11434/v1 ', 'models')).toBe('http://localhost:11434/v1/models')
})

it('names the host for messages, falling back to the raw text', () => {
  expect(hostOf('https://openrouter.ai/api/v1')).toBe('openrouter.ai')
  expect(hostOf('http://localhost:11434/v1')).toBe('localhost:11434')
  expect(hostOf('not a url')).toBe('not a url')
  expect(hostOf('')).toBe('the provider')
})

it('recognises servers on this computer', () => {
  expect(isLocalBaseUrl('http://localhost:11434/v1')).toBe(true)
  expect(isLocalBaseUrl('http://127.0.0.1:1234/v1')).toBe(true)
  expect(isLocalBaseUrl('http://[::1]:8080/v1')).toBe(true)
  expect(isLocalBaseUrl('http://ollama.localhost/v1')).toBe(true)
  expect(isLocalBaseUrl('https://api.deepinfra.com/v1/openai')).toBe(false)
  expect(isLocalBaseUrl('garbage')).toBe(false)
  expect(portOf('http://localhost:11434/v1')).toBe('11434')
  expect(portOf('https://api.openai.com/v1')).toBe('')
})

it('accepts only absolute http and https addresses as base URLs', () => {
  expect(isHttpUrl('https://api.openai.com/v1')).toBe(true)
  expect(isHttpUrl(' http://localhost:11434/v1 ')).toBe(true)
  for (const bad of ['', 'api.openai.com/v1', '/v1', 'ftp://llm.test', 'javascript:alert(1)']) expect(isHttpUrl(bad)).toBe(false)
})
