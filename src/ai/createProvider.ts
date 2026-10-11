import type { ProviderProfile } from '../db/db'
import { createAnthropicProvider } from './anthropic'
import { createOpenAiCompatibleProvider } from './openaiCompatible'
import { ProviderError, type LlmProvider } from './types'
import { isHttpUrl } from './url'

const NOT_A_URL = 'The base URL is not a full http(s) address'

/** Fails every call before any request, so a key is never sent to a relative address on this site. */
function invalidBaseUrlProvider(): LlmProvider {
  return {
    listModels: () => Promise.reject(new ProviderError('bad-request', NOT_A_URL)),
    streamChat: () => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new ProviderError('bad-request', NOT_A_URL)) }),
    }),
  }
}

export function createProvider(profile: ProviderProfile): LlmProvider {
  if (!isHttpUrl(profile.baseUrl)) return invalidBaseUrlProvider()
  switch (profile.adapter) {
    case 'anthropic':
      return createAnthropicProvider({ baseUrl: profile.baseUrl, apiKey: profile.apiKey })
    case 'openai-compatible':
      return createOpenAiCompatibleProvider({
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        streaming: profile.capabilities.streaming,
      })
  }
}
