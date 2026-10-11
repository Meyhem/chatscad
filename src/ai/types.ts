export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string /* base64, no data: prefix */ }

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface ChatRequest {
  model: string
  system: string
  messages: LlmMessage[]
  maxTokens?: number // default 16000
  temperature?: number // omitted unless set (variants in M4 may set it)
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Provider-reported cost in USD, when the provider sends one (OpenRouter). */
  costUsd?: number
}

export type ChatEvent = { type: 'text'; delta: string } | { type: 'usage'; usage: Usage }

export interface ModelPrice {
  inputPerMTok: number
  outputPerMTok: number
}

export interface ModelInfo {
  id: string
  name?: string
  /** Prices the provider's /models reports (OpenRouter), USD per million tokens. */
  price?: ModelPrice
}

export interface ProviderCapabilities {
  streaming: boolean
  vision: boolean
  audio: boolean
}

export type AdapterKind = 'openai-compatible' | 'anthropic'

export interface LlmProvider {
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  /** Yields text deltas, then exactly one usage event (zeros if the provider sent none). Throws ProviderError. */
  streamChat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>
}

export type ProviderErrorKind = 'network' | 'auth' | 'not-found' | 'rate-limit' | 'bad-request' | 'server' | 'aborted'

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** `ChatRequest.maxTokens` when the caller leaves it out. */
export const DEFAULT_MAX_TOKENS = 16000
