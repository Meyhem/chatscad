// @vitest-environment node
import { createOpenAiCompatibleProvider, relaxRequest } from './openaiCompatible'
import type { ChatEvent, ChatRequest } from './types'
import type { FetchLike } from './url'

interface Call {
  url: string
  init: RequestInit
  body: Record<string, unknown> | undefined
}

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Call[] = []
  const fetch: FetchLike = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const next = responses.shift()
    if (!next) throw new Error('fakeFetch: no response left')
    if (next instanceof Error) throw next
    return next
  })
  return { fetch, calls }
}

function sse(...chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const delta = (content: string) => ({ choices: [{ index: 0, delta: { content } }] })

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

const REQ: ChatRequest = { model: 'gpt-test', system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }] }

function provider(f: FetchLike, apiKey = 'sk-test', streaming = true) {
  return createOpenAiCompatibleProvider({ baseUrl: 'https://api.example.com/v1/', apiKey, streaming, fetch: f })
}

describe('streamChat', () => {
  it('streams text deltas, then one usage event with the provider cost', async () => {
    const { fetch, calls } = fakeFetch(
      sse(delta('Made '), delta('a cube.'), { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 310, cost: 0.011 } }, '[DONE]'),
    )
    expect(await collect(provider(fetch).streamChat(REQ))).toEqual([
      { type: 'text', delta: 'Made ' },
      { type: 'text', delta: 'a cube.' },
      { type: 'usage', usage: { inputTokens: 1000, outputTokens: 310, costUsd: 0.011 } },
    ])
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')
    expect(calls[0].init.method).toBe('POST')
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer sk-test')
    expect(calls[0].body).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
      ],
      max_tokens: 16000,
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('sends temperature only when the request sets it', async () => {
    const { fetch, calls } = fakeFetch(sse('[DONE]'))
    await collect(provider(fetch).streamChat({ ...REQ, temperature: 0.7, maxTokens: 512 }))
    expect(calls[0].body).toMatchObject({ temperature: 0.7, max_tokens: 512 })
  })

  it('sends no Authorization header without a key (Ollama, LM Studio)', async () => {
    const { fetch, calls } = fakeFetch(sse('[DONE]'))
    await collect(provider(fetch, '  ').streamChat(REQ))
    expect(new Headers(calls[0].init.headers).has('Authorization')).toBe(false)
  })

  it('yields zero usage when the provider sends none', async () => {
    const { fetch } = fakeFetch(sse(delta('ok'), '[DONE]'))
    const events = await collect(provider(fetch).streamChat(REQ))
    expect(events.at(-1)).toEqual({ type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } })
  })

  it('takes usage that arrives on the last content chunk (DeepInfra style)', async () => {
    const { fetch } = fakeFetch(sse({ ...delta('x'), usage: { prompt_tokens: 7, completion_tokens: 2 } }, '[DONE]'))
    const events = await collect(provider(fetch).streamChat(REQ))
    expect(events.at(-1)).toEqual({ type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } })
  })

  it('retries once without stream_options when the server rejects it', async () => {
    const { fetch, calls } = fakeFetch(
      json(400, { error: { message: "Unrecognized request argument supplied: stream_options" } }),
      sse(delta('ok'), '[DONE]'),
    )
    const events = await collect(provider(fetch).streamChat(REQ))
    expect(events[0]).toEqual({ type: 'text', delta: 'ok' })
    expect(calls).toHaveLength(2)
    expect(calls[1].body).not.toHaveProperty('stream_options')
    expect(calls[1].body).toMatchObject({ stream: true })
  })

  it('renames max_tokens to max_completion_tokens when the model asks for it', async () => {
    const { fetch, calls } = fakeFetch(
      json(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }),
      sse('[DONE]'),
    )
    await collect(provider(fetch).streamChat(REQ))
    expect(calls[1].body).not.toHaveProperty('max_tokens')
    expect(calls[1].body).toMatchObject({ max_completion_tokens: 16000 })
  })

  it('reports any other 400 without retrying', async () => {
    const { fetch, calls } = fakeFetch(json(400, { error: { message: 'messages: too long' } }))
    await expect(collect(provider(fetch).streamChat(REQ))).rejects.toMatchObject({
      kind: 'bad-request',
      status: 400,
      message: 'messages: too long',
    })
    expect(calls).toHaveLength(1)
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [429, 'rate-limit'],
    [500, 'server'],
    [503, 'server'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const { fetch } = fakeFetch(json(status, { error: { message: 'nope' } }))
    await expect(collect(provider(fetch).streamChat(REQ))).rejects.toMatchObject({ kind, status, message: 'nope' })
  })

  it('reports a rejected fetch (CORS, offline, wrong host) as a network error', async () => {
    const { fetch } = fakeFetch(new TypeError('Failed to fetch'))
    await expect(collect(provider(fetch).streamChat(REQ))).rejects.toMatchObject({ kind: 'network' })
  })

  it('reports an abort as aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetch } = fakeFetch(new DOMException('The operation was aborted.', 'AbortError'))
    await expect(collect(provider(fetch).streamChat(REQ, controller.signal))).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('turns an error object inside the stream into a server error', async () => {
    const { fetch } = fakeFetch(sse(delta('par'), { error: { message: 'upstream overloaded' } }))
    await expect(collect(provider(fetch).streamChat(REQ))).rejects.toMatchObject({ kind: 'server', message: 'upstream overloaded' })
  })

  it('sends a plain request and yields the whole reply when streaming is off', async () => {
    const { fetch, calls } = fakeFetch(
      json(200, { choices: [{ message: { content: 'All at once.' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    )
    expect(await collect(provider(fetch, 'k', false).streamChat(REQ))).toEqual([
      { type: 'text', delta: 'All at once.' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } },
    ])
    expect(calls[0].body).not.toHaveProperty('stream')
    expect(calls[0].body).not.toHaveProperty('stream_options')
  })

  it('maps image parts to image_url data URLs', async () => {
    const { fetch, calls } = fakeFetch(sse('[DONE]'))
    await collect(
      provider(fetch).streamChat({
        ...REQ,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Like this' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }] }],
      }),
    )
    expect((calls[0].body?.messages as unknown[])[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Like this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    })
  })
})

describe('listModels', () => {
  it('lists model ids sorted, with OpenRouter prices converted to USD per million tokens', async () => {
    const { fetch, calls } = fakeFetch(
      json(200, {
        data: [
          { id: 'z-model' },
          { id: 'anthropic/claude-x', name: 'Claude X', pricing: { prompt: '0.000003', completion: '0.000015' } },
          { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
          { name: 'no id' },
        ],
      }),
    )
    expect(await provider(fetch).listModels()).toEqual([
      { id: 'anthropic/claude-x', name: 'Claude X', price: { inputPerMTok: 3, outputPerMTok: 15 } },
      { id: 'openrouter/auto' },
      { id: 'z-model' },
    ])
    expect(calls[0].url).toBe('https://api.example.com/v1/models')
    expect(calls[0].init.method ?? 'GET').toBe('GET')
  })

  it('throws a typed error when the key is rejected', async () => {
    const { fetch } = fakeFetch(json(401, { error: { message: 'Incorrect API key provided' } }))
    await expect(provider(fetch).listModels()).rejects.toMatchObject({ kind: 'auth', status: 401 })
  })
})

describe('relaxRequest', () => {
  it('returns null when the error names nothing it can drop', () => {
    expect(relaxRequest({ model: 'm', max_tokens: 5 }, 'model not found')).toBeNull()
  })
  it('drops max_tokens when the server complains about it alone', () => {
    expect(relaxRequest({ model: 'm', max_tokens: 5 }, 'max_tokens is too large: 16000')).toEqual({ model: 'm' })
  })
})
