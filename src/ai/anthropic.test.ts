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
    { type: 'usage', usage: { inputTokens: 812, outputTokens: 498 } },
  ])
})

it('posts to /v1/messages with the browser-access header, max_tokens 16000, and no thinking or temperature', async () => {
  const { fetch, calls } = fakeFetch(sse(RECORDED_SSE))
  await collect(provider(fetch).streamChat({ ...REQ, temperature: 0.9 }))
  expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
  const headers = new Headers(calls[0].init.headers)
  expect(headers.get('x-api-key')).toBe('sk-ant-test')
  expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
  const body = JSON.parse(String(calls[0].init.body))
  expect(body).toMatchObject({ model: 'claude-test', max_tokens: 16000, system: 'Be brief.', stream: true })
  expect(body.messages).toEqual([{ role: 'user', content: 'A cube' }])
  expect(body).not.toHaveProperty('temperature')
  expect(body).not.toHaveProperty('thinking')
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
