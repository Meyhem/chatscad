import type { ProviderProfile } from '../db/db'
import { createAnthropicProvider } from './anthropic'
import { createOpenAiCompatibleProvider } from './openaiCompatible'
import { ProviderError, type LlmProvider } from './types'
import { resolveApiKey } from '../security/lock'
import { isHttpUrl } from './url'

const NOT_A_URL = 'The base URL is not a full http(s) address'

/** Fails every call before any request: used for a relative base URL (the key would go to this site) and for locked keys. */
function failingProvider(error: ProviderError): LlmProvider {
  return {
    listModels: () => Promise.reject(error),
    streamChat: () => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
    }),
  }
}

export function createProvider(profile: ProviderProfile): LlmProvider {
  if (!isHttpUrl(profile.baseUrl)) return failingProvider(new ProviderError('bad-request', NOT_A_URL))
  let apiKey: string
  try {
    // Throws ProviderError('auth', LOCKED_MESSAGE) while the keys are locked; never passes ciphertext on.
    apiKey = resolveApiKey(profile)
  } catch (e) {
    if (e instanceof ProviderError) return failingProvider(e)
    throw e
  }
  switch (profile.adapter) {
    case 'anthropic':
      return createAnthropicProvider({ baseUrl: profile.baseUrl, apiKey, models: profile.cachedModels })
    case 'openai-compatible':
      return createOpenAiCompatibleProvider({
        baseUrl: profile.baseUrl,
        apiKey,
        streaming: profile.capabilities.streaming,
      })
  }
}
