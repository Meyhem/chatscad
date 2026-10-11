import type { ProviderProfile } from '../db/db'
import { createProvider } from './createProvider'
import type { AdapterKind, ChatRequest } from './types'

const profile = (adapter: AdapterKind, baseUrl: string): ProviderProfile => ({
  id: 'p1',
  name: 'Test',
  adapter,
  baseUrl,
  apiKey: 'test-key',
  defaultModel: 'm',
  cachedModels: [],
  capabilities: { streaming: true, vision: true, audio: false },
  priceTable: {},
  createdAt: 0,
  updatedAt: 0,
})

const REQUEST: ChatRequest = {
  model: 'm',
  system: 'sys',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Like this' }, { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }],
}

/** Records request bodies and answers 400, so the stream ends right after the request is sent. */
function captureBodies(): unknown[] {
  const bodies: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = init?.body ?? (input instanceof Request ? await input.text() : null)
      if (typeof raw === 'string') bodies.push(JSON.parse(raw))
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'stop here' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  return bodies
}

async function drain(events: AsyncIterable<unknown>): Promise<void> {
  const it = events[Symbol.asyncIterator]()
  try {
    while (!(await it.next()).done) {
      // keep reading until the stream ends or throws
    }
  } catch {
    // the 400 ends the stream; only the request body matters here
  }
}

afterEach(() => vi.unstubAllGlobals())

it('the OpenAI-compatible adapter sends images as image_url data URLs', async () => {
  const bodies = captureBodies()
  await drain(createProvider(profile('openai-compatible', 'https://example.test/v1')).streamChat(REQUEST))
  const body = bodies[0] as { messages: Array<{ role: string; content: unknown }> }
  expect(body.messages.at(-1)?.content).toEqual([
    { type: 'text', text: 'Like this' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
  ])
})

it('the Anthropic adapter sends images as base64 image blocks', async () => {
  const bodies = captureBodies()
  await drain(createProvider(profile('anthropic', 'https://example.test')).streamChat(REQUEST))
  const body = bodies[0] as { messages: Array<{ role: string; content: unknown }> }
  expect(body.messages[0].content).toEqual([
    { type: 'text', text: 'Like this' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
  ])
})
