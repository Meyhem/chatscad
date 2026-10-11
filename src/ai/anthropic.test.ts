// @vitest-environment node
import { createAnthropicProvider } from './anthropic'
import type { ChatEvent, ChatRequest } from './types'
import type { FetchLike } from './url'

interface Call {
  url: string
  init: RequestInit
}

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Call[] = []
  const fetch: FetchLike = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (!next) throw new Error('fakeFetch: no response left')
    if (next instanceof Error) throw next
    return next
  })
  return { fetch, calls }
}

/** Recorded from the Messages API (ids shortened). */
const RECORDED_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-test","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":812,"output_tokens":3}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: ping',
  'data: {"type":"ping"}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Made a "}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"cube."}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":498}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n')

const sse = (text: string) => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const apiError = (status: number, type: string, message: string) => json(status, { type: 'error', error: { type, message } })

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

const REQ: ChatRequest = { model: 'claude-test', system: 'Be brief.', messages: [{ role: 'user', content: 'A cube' }] }

function provider(fetch: FetchLike, apiKey = 'sk-ant-test') {
  return createAnthropicProvider({ baseUrl: 'https://api.anthropic.com', apiKey, fetch, maxRetries: 0 })
}

it('streams text deltas and reports input tokens from message_start and output tokens from message_delta', async () => {
  const { fetch } = fakeFetch(sse(RECORDED_SSE))
  expect(await collect(provider(fetch).streamChat(REQ))).toEqual([
    { type: 'text', delta: 'Made a ' },
    { type: 'text', delta: 'cube.' },
    { type: 'usage', usage: { inputTokens: 812, outputTokens: 498 }, stopReason: 'end' },
  ])
})

it('posts to /v1/messages with the browser-access header, max_tokens 64000 when the model is unknown, and no thinking or temperature', async () => {
  const { fetch, calls } = fakeFetch(sse(RECORDED_SSE))
  await collect(provider(fetch).streamChat({ ...REQ, temperature: 0.9 }))
  expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
  const headers = new Headers(calls[0].init.headers)
  expect(headers.get('x-api-key')).toBe('sk-ant-test')
  expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
  const body = JSON.parse(String(calls[0].init.body))
  expect(body).toMatchObject({ model: 'claude-test', max_tokens: 64000, system: 'Be brief.', stream: true })
  expect(body.messages).toEqual([{ role: 'user', content: 'A cube' }])
  expect(body).not.toHaveProperty('temperature')
  expect(body).not.toHaveProperty('thinking')
})

it('reports stop_reason max_tokens as a length stop', async () => {
  const { fetch } = fakeFetch(sse(RECORDED_SSE.replace('"stop_reason":"end_turn"', '"stop_reason":"max_tokens"')))
  expect((await collect(provider(fetch).streamChat(REQ))).at(-1)).toMatchObject({ type: 'usage', stopReason: 'length' })
})

it('sends image parts as base64 image blocks', async () => {
  const { fetch, calls } = fakeFetch(sse(RECORDED_SSE))
  await collect(
    provider(fetch).streamChat({
      ...REQ,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Like this' }, { type: 'image', mediaType: 'image/jpeg', data: 'BBBB' }] }],
    }),
  )
  expect(JSON.parse(String(calls[0].init.body)).messages[0].content).toEqual([
    { type: 'text', text: 'Like this' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } },
  ])
})

it.each([
  [401, 'authentication_error', 'auth'],
  [403, 'permission_error', 'auth'],
  [404, 'not_found_error', 'not-found'],
  [429, 'rate_limit_error', 'rate-limit'],
  [400, 'invalid_request_error', 'bad-request'],
  [500, 'api_error', 'server'],
  [529, 'overloaded_error', 'server'],
])('maps HTTP %i (%s) to %s with the API message', async (status, type, kind) => {
  const { fetch } = fakeFetch(apiError(status, type, 'details from the API'))
  await expect(collect(provider(fetch).streamChat(REQ))).rejects.toMatchObject({
    kind,
    status,
    message: 'details from the API',
  })
})

it('maps a failed fetch (CORS, offline) to network', async () => {
  const { fetch } = fakeFetch(new TypeError('Failed to fetch'))
  await expect(collect(provider(fetch).streamChat(REQ))).rejects.toMatchObject({ kind: 'network' })
})

it('maps an abort to aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const { fetch } = fakeFetch(sse(RECORDED_SSE))
  await expect(collect(provider(fetch).streamChat(REQ, controller.signal))).rejects.toMatchObject({ kind: 'aborted' })
})

it('fails with auth before any request when the key is empty', async () => {
  const { fetch, calls } = fakeFetch()
  await expect(collect(provider(fetch, ' ').streamChat(REQ))).rejects.toMatchObject({ kind: 'auth' })
  await expect(provider(fetch, '').listModels()).rejects.toMatchObject({ kind: 'auth' })
  expect(calls).toHaveLength(0)
})

it('lists models with their display names', async () => {
  const { fetch, calls } = fakeFetch(
    json(200, {
      data: [
        { type: 'model', id: 'claude-a', display_name: 'Claude A', created_at: '2026-01-01T00:00:00Z' },
        { type: 'model', id: 'claude-b', display_name: 'Claude B', created_at: '2026-02-01T00:00:00Z' },
      ],
      has_more: false,
      first_id: 'claude-a',
      last_id: 'claude-b',
    }),
  )
  expect(await provider(fetch).listModels()).toEqual([
    { id: 'claude-a', name: 'Claude A' },
    { id: 'claude-b', name: 'Claude B' },
  ])
  expect(calls[0].url).toContain('https://api.anthropic.com/v1/models')
})

/** A thinking block, then the text block (shape of the Messages API stream with summarized thinking). */
const THINKING_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_02","type":"message","role":"assistant","model":"claude-test","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":812,"output_tokens":3}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Wall is 1.6 mm."}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Made a cube."}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":1}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":498}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n')

it('streams thinking deltas as reasoning events', async () => {
  const { fetch } = fakeFetch(sse(THINKING_SSE))
  expect(await collect(provider(fetch).streamChat(REQ))).toEqual([
    { type: 'reasoning', delta: 'Wall is 1.6 mm.' },
    { type: 'text', delta: 'Made a cube.' },
    { type: 'usage', usage: { inputTokens: 812, outputTokens: 498 }, stopReason: 'end' },
  ])
})

const CAPS = {
  thinking: { supported: true, types: { enabled: { supported: false }, adaptive: { supported: true }, disabled: { supported: false } } },
  effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true } },
}

it('reads the output limit and thinking support from the model list', async () => {
  const { anthropicModelInfo } = await import('./anthropic')
  expect(anthropicModelInfo({ id: 'claude-x', display_name: 'Claude X', max_tokens: 128000, capabilities: CAPS })).toEqual({
    id: 'claude-x',
    name: 'Claude X',
    maxOutputTokens: 128000,
    reasoning: { efforts: true, canDisable: false, adaptive: true },
  })
  expect(anthropicModelInfo({ id: 'old', display_name: 'Old' })).toEqual({ id: 'old', name: 'Old' })
  expect(anthropicModelInfo({ id: 'odd', max_tokens: 'lots', capabilities: 'yes' })).toEqual({
    id: 'odd',
    reasoning: { efforts: false, canDisable: false, adaptive: false },
  })
})

it('sends the model limit as max_tokens and asks for summarized thinking on adaptive models', async () => {
  const { fetch, calls } = fakeFetch(sse(RECORDED_SSE))
  const p = createAnthropicProvider({
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-ant-test',
    fetch,
    maxRetries: 0,
    models: [{ id: 'claude-test', maxOutputTokens: 128000, reasoning: { efforts: true, canDisable: false, adaptive: true } }],
  })
  await collect(p.streamChat(REQ))
  const body = JSON.parse(String(calls[0].init.body))
  expect(body).toMatchObject({ max_tokens: 128000, thinking: { type: 'adaptive', display: 'summarized' } })
  expect(body).not.toHaveProperty('output_config')
})

const ADAPTIVE = [{ id: 'claude-test', maxOutputTokens: 128000, reasoning: { efforts: true, canDisable: true, adaptive: true } }]
const withModels = (fetch: FetchLike) =>
  createAnthropicProvider({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test', fetch, maxRetries: 0, models: ADAPTIVE })
const bodyOf = (call: { init: RequestInit }) => JSON.parse(String(call.init.body))

it('maps low/medium/high to adaptive summarized thinking with output_config.effort', async () => {
  const { fetch, calls } = fakeFetch(sse(RECORDED_SSE))
  await collect(withModels(fetch).streamChat({ ...REQ, reasoningEffort: 'high' }))
  expect(bodyOf(calls[0])).toMatchObject({ thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' } })
})

it('maps off to disabled thinking', async () => {
  const { fetch, calls } = fakeFetch(sse(RECORDED_SSE))
  await collect(withModels(fetch).streamChat({ ...REQ, reasoningEffort: 'off' }))
  expect(bodyOf(calls[0]).thinking).toEqual({ type: 'disabled' })
  expect(bodyOf(calls[0])).not.toHaveProperty('output_config')
})

it('retries at Low with a notice when the model refuses to turn thinking off', async () => {
  const { fetch, calls } = fakeFetch(
    apiError(400, 'invalid_request_error', 'thinking.type: "disabled" is not supported for this model'),
    sse(RECORDED_SSE),
  )
  const events = await collect(withModels(fetch).streamChat({ ...REQ, reasoningEffort: 'off' }))
  expect(events[0]).toEqual({ type: 'notice', text: "This model can't turn reasoning off, so it used Low." })
  expect(bodyOf(calls[1])).toMatchObject({ output_config: { effort: 'low' } })
  expect(calls).toHaveLength(2)
})

it('does not retry other 400s for off', async () => {
  const { fetch, calls } = fakeFetch(apiError(400, 'invalid_request_error', 'messages: empty'))
  await expect(collect(withModels(fetch).streamChat({ ...REQ, reasoningEffort: 'off' }))).rejects.toMatchObject({ kind: 'bad-request' })
  expect(calls).toHaveLength(1)
})

it('asks for summarized thinking by default only on uncapped requests (not Test connection or the visual check)', async () => {
  const { fetch, calls } = fakeFetch(sse(RECORDED_SSE))
  await collect(withModels(fetch).streamChat({ ...REQ, maxTokens: 200 }))
  expect(bodyOf(calls[0])).not.toHaveProperty('thinking')
  expect(bodyOf(calls[0]).max_tokens).toBe(200)
})

it('retries once at the limit the API names when the fallback max_tokens is too high', async () => {
  const { fetch, calls } = fakeFetch(
    apiError(400, 'invalid_request_error', 'max_tokens: 64000 > 32000, which is the maximum allowed number of output tokens for claude-opus-4'),
    sse(RECORDED_SSE),
  )
  const events = await collect(provider(fetch).streamChat(REQ))
  expect(calls).toHaveLength(2)
  expect(bodyOf(calls[1]).max_tokens).toBe(32000)
  expect(events.at(-1)).toMatchObject({ type: 'usage' })
})

it('does not second-guess a max_tokens the caller chose', async () => {
  const { fetch, calls } = fakeFetch(apiError(400, 'invalid_request_error', 'max_tokens: 99999 > 32000, which is the maximum allowed'))
  await expect(collect(provider(fetch).streamChat({ ...REQ, maxTokens: 99999 }))).rejects.toMatchObject({ kind: 'bad-request' })
  expect(calls).toHaveLength(1)
})
