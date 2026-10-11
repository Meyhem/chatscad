import Anthropic from '@anthropic-ai/sdk'
import { ProviderError, type ChatEvent, type ChatRequest, type LlmMessage, type LlmProvider, type ModelInfo, type ReasoningEffort, type StopReason, type Usage } from './types'
import type { FetchLike } from './url'

export interface AnthropicOptions {
  baseUrl: string
  apiKey: string
  fetch?: FetchLike
  /** SDK retries for 408/409/429/5xx and connection errors. Default 2; tests pass 0. */
  maxRetries?: number
  /** The profile's cached model list: output limits and thinking support per model. */
  models?: ModelInfo[]
}

/** `max_tokens` is required; used when the model list did not report the model's limit. */
export const ANTHROPIC_FALLBACK_MAX_TOKENS = 64000

export function anthropicStopReason(r: string | null | undefined): StopReason {
  if (r === 'max_tokens') return 'length'
  return r === 'end_turn' || r === null || r === undefined ? 'end' : 'other'
}

export const EFFORT_OFF_UNSUPPORTED = "This model can't turn reasoning off, so it used Low."

function thinkingParams(effort: ReasoningEffort | undefined, info: ModelInfo | undefined): Record<string, unknown> {
  if (effort === 'off') return { thinking: { type: 'disabled' } }
  if (effort) return { thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort } }
  // Current models return empty thinking text unless asked for a summary.
  return info?.reasoning?.adaptive ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}
}

/** True when the untyped capabilities tree has `supported: true` at `path`. */
function supported(node: unknown, ...path: string[]): boolean {
  let n: unknown = node
  for (const key of path) {
    if (typeof n !== 'object' || n === null) return false
    n = (n as Record<string, unknown>)[key]
  }
  return typeof n === 'object' && n !== null && (n as { supported?: unknown }).supported === true
}

export function anthropicModelInfo(m: { id: string; display_name?: string; max_tokens?: unknown; capabilities?: unknown }): ModelInfo {
  return {
    id: m.id,
    ...(typeof m.display_name === 'string' ? { name: m.display_name } : {}),
    ...(typeof m.max_tokens === 'number' && m.max_tokens > 0 ? { maxOutputTokens: m.max_tokens } : {}),
    ...(m.capabilities !== undefined
      ? {
          reasoning: {
            efforts: supported(m.capabilities, 'effort'),
            canDisable: supported(m.capabilities, 'thinking', 'types', 'disabled'),
            adaptive: supported(m.capabilities, 'thinking', 'types', 'adaptive'),
          },
        }
      : {}),
  }
}

function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined
  const nested = body?.error?.message
  return typeof nested === 'string' && nested.trim() ? nested.trim() : err.message
}

export function toProviderError(err: unknown, signal?: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err
  if (err instanceof Anthropic.APIUserAbortError || signal?.aborted) return new ProviderError('aborted', 'The request was stopped')
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('network', err.message)
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('auth', apiMessage(err), err.status)
  }
  if (err instanceof Anthropic.NotFoundError) return new ProviderError('not-found', apiMessage(err), err.status)
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('rate-limit', apiMessage(err), err.status)
  if (err instanceof Anthropic.BadRequestError) return new ProviderError('bad-request', apiMessage(err), err.status)
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined
    return new ProviderError(status !== undefined && status >= 500 ? 'server' : 'bad-request', apiMessage(err), status)
  }
  return new ProviderError('server', err instanceof Error ? err.message : String(err))
}

function toAnthropicMessage(m: LlmMessage): Anthropic.MessageParam {
  if (typeof m.content === 'string') return { role: m.role, content: m.content }
  return {
    role: m.role,
    content: m.content.map((p): Anthropic.TextBlockParam | Anthropic.ImageBlockParam =>
      p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } },
    ),
  }
}

export function createAnthropicProvider(opts: AnthropicOptions): LlmProvider {
  let client: Anthropic | null = null
  const getClient = (): Anthropic => {
    if (!opts.apiKey.trim()) throw new ProviderError('auth', 'This profile has no API key')
    client ??= new Anthropic({
      apiKey: opts.apiKey.trim(),
      baseURL: opts.baseUrl.trim().replace(/\/+$/, '') || undefined,
      dangerouslyAllowBrowser: true,
      maxRetries: opts.maxRetries ?? 2,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    })
    return client
  }

  async function* streamOnce(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 }
    let stopReason: StopReason = 'end'
    try {
      // No `temperature`: current Claude models reject sampling parameters.
      const info = opts.models?.find((m) => m.id === req.model)
      const params: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens ?? info?.maxOutputTokens ?? ANTHROPIC_FALLBACK_MAX_TOKENS,
        system: req.system,
        messages: req.messages.map(toAnthropicMessage),
        ...thinkingParams(req.reasoningEffort, info),
      }
      const stream = getClient().messages.stream(params as unknown as Anthropic.MessageStreamParams, { signal })
      for await (const event of stream) {
        if (event.type === 'message_start') {
          usage.inputTokens = event.message.usage.input_tokens
          usage.outputTokens = event.message.usage.output_tokens
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', delta: event.delta.text }
        } else if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
          yield { type: 'reasoning', delta: event.delta.thinking }
        } else if (event.type === 'message_delta') {
          usage.outputTokens = event.usage.output_tokens
          stopReason = anthropicStopReason(event.delta.stop_reason)
          if (typeof event.usage.input_tokens === 'number') usage.inputTokens = event.usage.input_tokens
        }
      }
    } catch (err) {
      throw toProviderError(err, signal)
    }
    yield { type: 'usage', usage, stopReason }
  }

  return {
    async listModels(signal) {
      const models: ModelInfo[] = []
      try {
        for await (const m of getClient().models.list({ limit: 100 }, { signal })) models.push(anthropicModelInfo(m as unknown as Parameters<typeof anthropicModelInfo>[0]))
      } catch (err) {
        throw toProviderError(err, signal)
      }
      return models
    },

    async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
      try {
        yield* streamOnce(req, signal)
      } catch (err) {
        // Some models (Opus 5.5, Sonnet 5.5) cannot turn thinking off; the 400 comes before any event.
        if (req.reasoningEffort === 'off' && err instanceof ProviderError && err.kind === 'bad-request' && /thinking/i.test(err.message)) {
          yield { type: 'notice', text: EFFORT_OFF_UNSUPPORTED }
          yield* streamOnce({ ...req, reasoningEffort: 'low' }, signal)
          return
        }
        throw err
      }
    },
  }
}
