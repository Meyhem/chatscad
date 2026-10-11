import type { AdapterKind } from '../ai/types'

export interface ProviderPreset {
  id: string
  /** Shown in the Add menu. */
  label: string
  /** The new profile's name. */
  name: string
  adapter: AdapterKind
  baseUrl: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', name: 'OpenAI', adapter: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', name: 'OpenRouter', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'deepinfra', label: 'DeepInfra', name: 'DeepInfra', adapter: 'openai-compatible', baseUrl: 'https://api.deepinfra.com/v1/openai' },
  { id: 'ollama', label: 'Ollama', name: 'Ollama on this computer', adapter: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio', name: 'LM Studio on this computer', adapter: 'openai-compatible', baseUrl: 'http://localhost:1234/v1' },
  { id: 'anthropic', label: 'Anthropic', name: 'Anthropic', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'custom', label: 'Custom', name: 'Custom provider', adapter: 'openai-compatible', baseUrl: '' },
]
