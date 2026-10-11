import type { ProviderProfile } from '../db/db'
import { createAnthropicProvider } from './anthropic'
import { createOpenAiCompatibleProvider } from './openaiCompatible'
import type { LlmProvider } from './types'

export function createProvider(profile: ProviderProfile): LlmProvider {
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
