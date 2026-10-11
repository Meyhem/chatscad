import type { LoadProgress } from './loadProgress'

/** GET `url` into memory, reporting bytes as they arrive. Never reports a total it cannot trust. */
export async function fetchWithProgress(
  url: string,
  onProgress: (p: LoadProgress) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length'))
  // A compressed transfer declares the compressed length, but the reader yields decompressed bytes.
  let total: number | null = res.headers.get('content-encoding') || !(declared > 0) ? null : declared

  if (!res.body) {
    const buf = await res.arrayBuffer()
    onProgress({ loaded: buf.byteLength, total: buf.byteLength })
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  onProgress({ loaded, total })
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    if (total !== null && loaded > total) total = null
    onProgress({ loaded, total })
  }

  const out = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer
}
