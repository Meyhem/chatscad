// @vitest-environment node
import { fetchWithProgress } from './fetchWithProgress'
import type { LoadProgress } from './loadProgress'

function streamed(chunks: number[], headers: Record<string, string>, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const n of chunks) controller.enqueue(new Uint8Array(n).fill(7))
      controller.close()
    },
  })
  return new Response(body, { status, headers })
}

const fakeFetch = (res: Response) => vi.fn(async () => res) as unknown as typeof fetch

async function run(res: Response) {
  const seen: LoadProgress[] = []
  const buf = await fetchWithProgress('/chatscad/openscad/openscad.wasm', (p) => seen.push(p), fakeFetch(res))
  return { buf, seen }
}

it('reports bytes as they arrive against Content-Length and returns all of them', async () => {
  const { buf, seen } = await run(streamed([3, 4], { 'content-length': '7' }))
  expect(buf.byteLength).toBe(7)
  expect(new Uint8Array(buf).every((b) => b === 7)).toBe(true)
  expect(seen).toEqual([
    { loaded: 0, total: 7 },
    { loaded: 3, total: 7 },
    { loaded: 7, total: 7 },
  ])
})

it('drops the total for a compressed transfer, whose length is the compressed size', async () => {
  const { seen } = await run(streamed([3, 4], { 'content-length': '2', 'content-encoding': 'gzip' }))
  expect(seen.map((p) => p.total)).toEqual([null, null, null])
})

it('drops the total when there is no length or more bytes arrive than declared', async () => {
  expect((await run(streamed([3], {}))).seen.map((p) => p.total)).toEqual([null, null])
  expect((await run(streamed([3, 4], { 'content-length': '5' }))).seen).toEqual([
    { loaded: 0, total: 5 },
    { loaded: 3, total: 5 },
    { loaded: 7, total: null },
  ])
})

it('fails with the URL and the HTTP status', async () => {
  await expect(run(streamed([], {}, 404))).rejects.toThrow('Failed to download /chatscad/openscad/openscad.wasm: HTTP 404')
})
