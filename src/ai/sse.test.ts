// @vitest-environment node
import { parseSse, type SseEvent } from './sse'

const enc = new TextEncoder()

function streamOf(...chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c)
      controller.close()
    },
  })
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = []
  for await (const e of parseSse(body)) out.push(e)
  return out
}

it('yields one event per blank-line-terminated block, with the default event name', async () => {
  expect(await collect(streamOf('data: {"a":1}\n\ndata: [DONE]\n\n'))).toEqual([
    { event: 'message', data: '{"a":1}' },
    { event: 'message', data: '[DONE]' },
  ])
})

it('keeps the event field and joins multi-line data with newlines', async () => {
  expect(await collect(streamOf('event: message_start\ndata: one\ndata: two\n\n'))).toEqual([
    { event: 'message_start', data: 'one\ntwo' },
  ])
})

it('reassembles lines split across chunks, including a split multi-byte character', async () => {
  const bytes = enc.encode('ta: 20 × 20\n\n')
  const cut = bytes.indexOf(0xc3) + 1 // inside the two-byte "×"
  expect(await collect(streamOf('da', bytes.slice(0, cut), bytes.slice(cut)))).toEqual([
    { event: 'message', data: '20 × 20' },
  ])
})

it('accepts CRLF and CR line endings, also when \\r\\n is split between chunks', async () => {
  expect(await collect(streamOf('data: a\r', '\n\r\ndata: b\r\rdata: c\n\n'))).toEqual([
    { event: 'message', data: 'a' },
    { event: 'message', data: 'b' },
    { event: 'message', data: 'c' },
  ])
})

it('ignores comment lines such as OpenRouter keep-alives', async () => {
  expect(await collect(streamOf(': OPENROUTER PROCESSING\n\ndata: x\n\n'))).toEqual([{ event: 'message', data: 'x' }])
})

it('flushes a final event that has no trailing blank line', async () => {
  expect(await collect(streamOf('data: last'))).toEqual([{ event: 'message', data: 'last' }])
})

it('cancels the body when the consumer stops early', async () => {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('data: 1\n\ndata: 2\n\n'))
    },
    cancel,
  })
  for await (const e of parseSse(body)) {
    expect(e.data).toBe('1')
    break
  }
  expect(cancel).toHaveBeenCalled()
})
