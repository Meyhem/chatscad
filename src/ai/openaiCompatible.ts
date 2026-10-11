import { errorMessage } from '../render/result'
import { parseSse } from './sse'
import {
  DEFAULT_MAX_TOKENS,
  ProviderError,
  type ChatEvent,
  type ChatRequest,
  type LlmMessage,
  type LlmProvider,
  type ModelInfo,
  type ModelPrice,
  type ProviderErrorKind,
  type Usage,
} from './types'
import { joinUrl, type FetchLike } from './url'

export interface OpenAiCompatibleOptions {
  baseUrl: string
  apiKey: string
  /** Profile capability; false sends one plain request (for servers that cannot stream). Default true. */
  streaming?: boolean
  fetch?: FetchLike
}

type Body = Record<string, unknown>

interface OpenAiUsage {
  prompt_tokens?: number
  completion_tokens?: number
  cost?: number
}
interface OpenAiChunk {
  choices?: Array<{ delta?: { content?: string | null } }>
  usage?: OpenAiUsage | null
  error?: unknown
}
interface OpenAiCompletion {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: OpenAiUsage | null
}
interface OpenAiModel {
  id?: unknown
  name?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
}

export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  return 'bad-request'
}

function messageFrom(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown }
    const m = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message ?? parsed.detail)
    if (typeof m === 'string' && m.trim()) return m.trim()
  } catch {
    // not JSON: fall through to the raw text
  }
  return body.trim().slice(0, 300)
}

/** One retry-able fix per call: the parameter the error names is dropped or renamed. */
export function relaxRequest(body: Body, errorText: string): Body | null {
  const next: Body = { ...body }
  if ('stream_options' in next && /stream_options/.test(errorText)) {
    delete next.stream_options
    return next
  }
  if ('max_tokens' in next && /max_completion_tokens/.test(errorText)) {
    next.max_completion_tokens = next.max_tokens
    delete next.max_tokens
    return next
  }
  if ('max_tokens' in next && /max_tokens/.test(errorText)) {
    delete next.max_tokens
    return next
  }
  return null
}

function toUsage(u: OpenAiUsage): Usage {
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    ...(typeof u.cost === 'number' ? { costUsd: u.cost } : {}),
  }
}

function perMillion(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && value !== '' && value !== null && value !== undefined
    ? Number((n * 1_000_000).toPrecision(12))
    : null
}

function toPrice(pricing: OpenAiModel['pricing']): ModelPrice | undefined {
  if (!pricing) return undefined
  const input = perMillion(pricing.prompt)
  const output = perMillion(pricing.completion)
  return input === null || output === null ? undefined : { inputPerMTok: input, outputPerMTok: output }
}

function toOpenAiMessage(m: LlmMessage): Body {
  if (typeof m.content === 'string') return { role: m.role, content: m.content }
  return {
    role: m.role,
    content: m.content.map((p) =>
      p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } },
    ),
  }
}

function transportError(err: unknown, url: string, signal?: AbortSignal): ProviderError {
  if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
    return new ProviderError('aborted', 'The request was stopped')
  }
  return new ProviderError('network', `Couldn't reach ${url}: ${errorMessage(err)}`)
}

export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): LlmProvider {
  // Wrapped so window.fetch is never called unbound ("Illegal invocation").
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const streaming = opts.streaming ?? true

  const headers = (json: boolean): Record<string, string> => {
    const h: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {}
    if (opts.apiKey.trim()) h.Authorization = `Bearer ${opts.apiKey.trim()}`
    return h
  }

  async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal })
    } catch (err) {
      throw transportError(err, url, signal)
    }
  }

  async function failure(res: Response): Promise<{ error: ProviderError; text: string }> {
    const text = await res.text().catch(() => '')
    return { error: new ProviderError(kindForStatus(res.status), messageFrom(text) || `HTTP ${res.status}`, res.status), text }
  }

  async function postChat(url: string, body: Body, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await send(url, { method: 'POST', headers: headers(true), body: JSON.stringify(body) }, signal)
      if (res.ok) return res
      const { error, text } = await failure(res)
      const relaxed = res.status === 400 && attempt < 3 ? relaxRequest(body, text) : null
      if (!relaxed) throw error
      body = relaxed
    }
  }

  return {
    async listModels(signal) {
      const url = joinUrl(opts.baseUrl, 'models')
      const res = await send(url, { method: 'GET', headers: headers(false) }, signal)
      if (!res.ok) throw (await failure(res)).error
      let parsed: { data?: unknown }
      try {
        parsed = (await res.json()) as { data?: unknown }
      } catch (err) {
        if (signal?.aborted) throw transportError(err, url, signal)
        throw new ProviderError('server', `${url} did not answer with a model list`)
      }
      const rows = Array.isArray(parsed.data) ? (parsed.data as OpenAiModel[]) : []
      const models = rows.flatMap((m): ModelInfo[] => {
        if (typeof m.id !== 'string' || m.id === '') return []
        const price = toPrice(m.pricing)
        return [{ id: m.id, ...(typeof m.name === 'string' && m.name !== m.id ? { name: m.name } : {}), ...(price ? { price } : {}) }]
      })
      return models.sort((a, b) => a.id.localeCompare(b.id))
    },

    async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
      const url = joinUrl(opts.baseUrl, 'chat/completions')
      const body: Body = {
        model: req.model,
        messages: [{ role: 'system', content: req.system }, ...req.messages.map(toOpenAiMessage)],
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
      }
      const res = await postChat(url, body, signal)
      let usage: Usage = { inputTokens: 0, outputTokens: 0 }

      if (!streaming) {
        let reply: OpenAiCompletion
        try {
          reply = (await res.json()) as OpenAiCompletion
        } catch (err) {
          throw transportError(err, url, signal)
        }
        const text = reply.choices?.[0]?.message?.content ?? ''
        if (text) yield { type: 'text', delta: text }
        if (reply.usage) usage = toUsage(reply.usage)
        yield { type: 'usage', usage }
        return
      }

      if (!res.body) throw new ProviderError('server', `${url} answered without a body`)
      try {
        for await (const event of parseSse(res.body)) {
          if (event.data === '[DONE]') break
          let chunk: OpenAiChunk
          try {
            chunk = JSON.parse(event.data) as OpenAiChunk
          } catch {
            continue
          }
          if (chunk.error) throw new ProviderError('server', messageFrom(JSON.stringify(chunk)))
          const text = chunk.choices?.[0]?.delta?.content
          if (typeof text === 'string' && text !== '') yield { type: 'text', delta: text }
          if (chunk.usage) usage = toUsage(chunk.usage)
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err
        throw transportError(err, url, signal)
      }
      yield { type: 'usage', usage }
    },
  }
}
