export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string /* base64, no data: prefix */ }

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string | ContentPart[]
}

/** How hard a reasoning model thinks. Absent means the model's own default. */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'

/** Why a reply ended: finished, hit the output limit, or anything else (filters, tools). */
export type StopReason = 'end' | 'length' | 'other'

export interface ChatRequest {
  model: string
  system: string
  messages: LlmMessage[]
  maxTokens?: number // only when the caller needs a cap; adapters send none otherwise (Anthropic: the model's limit)
  temperature?: number // omitted unless set (variants in M4 may set it)
  reasoningEffort?: ReasoningEffort
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Provider-reported cost in USD, when the provider sends one (OpenRouter). */
  costUsd?: number
  /** Output tokens spent on reasoning, when the provider reports them. */
  reasoningTokens?: number
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'notice'; text: string } // the adapter adjusted the request (effort dropped or lowered)
  | { type: 'usage'; usage: Usage; stopReason: StopReason }

export interface ModelPrice {
  inputPerMTok: number
  outputPerMTok: number
}

export interface ModelInfo {
  id: string
  name?: string
  /** Prices the provider's /models reports (OpenRouter), USD per million tokens. */
  price?: ModelPrice
  /** Input kinds the provider reports for the model (OpenRouter's input_modalities). */
  capabilities?: { vision: boolean; audio: boolean }
  /** Output limit the provider reports for the model (Anthropic's max_tokens). */
  maxOutputTokens?: number
  /** Reasoning support the provider reports; absent when unknown. */
  reasoning?: ModelReasoning
}

export interface ModelReasoning {
  /** Accepts an effort setting: the effort picker shows. */
  efforts: boolean
  /** Can turn reasoning off: the picker offers Off. */
  canDisable: boolean
  /** Claude adaptive thinking: Default asks for a reasoning summary. */
  adaptive: boolean
}

export interface ProviderCapabilities {
  streaming: boolean
  vision: boolean
  audio: boolean
}

export type AdapterKind = 'openai-compatible' | 'anthropic'

export interface LlmProvider {
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  /** Yields text and reasoning deltas and notices, then exactly one usage event with the stop reason (zeros if the provider sent no usage). Throws ProviderError. */
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
