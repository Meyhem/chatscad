export interface SseEvent {
  event: string
  data: string
}

/** Parses a text/event-stream body (WHATWG rules: data/event fields, comments, CR/LF/CRLF, final flush). */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []
  let finished = false

  const takeLines = (final: boolean): string[] => {
    const lines: string[] = []
    for (;;) {
      const match = /\r\n|\r|\n/.exec(buffer)
      if (!match) return lines
      // A lone \r at the very end may be the first half of \r\n: wait for the next chunk.
      if (match[0] === '\r' && match.index === buffer.length - 1 && !final) return lines
      lines.push(buffer.slice(0, match.index))
      buffer = buffer.slice(match.index + match[0].length)
    }
  }

  const feed = (line: string): SseEvent | null => {
    if (line === '') {
      if (data.length === 0) {
        event = ''
        return null
      }
      const out = { event: event || 'message', data: data.join('\n') }
      event = ''
      data = []
      return out
    }
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
    return null
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      for (const line of takeLines(done)) {
        const e = feed(line)
        if (e) yield e
      }
      if (done) break
    }
    finished = true
    if (buffer !== '') {
      const e = feed(buffer)
      if (e) yield e
    }
    const last = feed('')
    if (last) yield last
  } finally {
    if (!finished) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
