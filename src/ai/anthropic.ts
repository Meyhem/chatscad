import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_MAX_TOKENS, ProviderError, type ChatEvent, type ChatRequest, type LlmMessage, type LlmProvider, type ModelInfo, type Usage } from './types'
import type { FetchLike } from './url'

export interface AnthropicOptions {
  baseUrl: string
  apiKey: string
  fetch?: FetchLike
  /** SDK retries for 408/409/429/5xx and connection errors. Default 2; tests pass 0. */
  maxRetries?: number
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

  return {
    async listModels(signal) {
      const models: ModelInfo[] = []
      try {
        for await (const m of getClient().models.list({ limit: 100 }, { signal })) models.push({ id: m.id, name: m.display_name })
      } catch (err) {
        throw toProviderError(err, signal)
      }
      return models
    },

    async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
      const usage: Usage = { inputTokens: 0, outputTokens: 0 }
      try {
        // No `thinking` and no `temperature`: current Claude models reject sampling parameters.
        const stream = getClient().messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
            system: req.system,
            messages: req.messages.map(toAnthropicMessage),
          },
          { signal },
        )
        for await (const event of stream) {
          if (event.type === 'message_start') {
            usage.inputTokens = event.message.usage.input_tokens
            usage.outputTokens = event.message.usage.output_tokens
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', delta: event.delta.text }
          } else if (event.type === 'message_delta') {
            usage.outputTokens = event.usage.output_tokens
            if (typeof event.usage.input_tokens === 'number') usage.inputTokens = event.usage.input_tokens
          }
        }
      } catch (err) {
        throw toProviderError(err, signal)
      }
      yield { type: 'usage', usage }
    },
  }
}
