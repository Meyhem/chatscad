import type { ContentPart, LlmMessage, LlmProvider, Usage } from '../ai/types'

const NO_JSON = 'The reply had no JSON object'

/** The end index (exclusive) of the balanced `{…}` starting at `start`, skipping braces inside strings. */
function objectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return -1
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The first JSON object in a model reply: a ```json fence, or the first balanced object in the text. */
export function extractJson(text: string): Record<string, unknown> {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text)
  const sources = fence ? [fence[1], text] : [text]
  for (const source of sources) {
    for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
      const end = objectEnd(source, start)
      if (end < 0) break
      try {
        const value: unknown = JSON.parse(source.slice(start, end))
        if (isObject(value)) return value
      } catch {
        // Not JSON from this brace; try the next one.
      }
    }
  }
  throw new Error(NO_JSON)
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  ...(a.costUsd !== undefined || b.costUsd !== undefined ? { costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) } : {}),
})

async function collect(provider: LlmProvider, req: Parameters<LlmProvider['streamChat']>[0], signal?: AbortSignal) {
  let text = ''
  let usage: Usage = { inputTokens: 0, outputTokens: 0 }
  for await (const event of provider.streamChat(req, signal)) {
    if (event.type === 'text') text += event.delta
    else if (event.type === 'usage') usage = event.usage
  }
  return { text, usage }
}

const RETRY = 'Reply with the JSON object only, no other text.'

/** One request whose reply must be a JSON object; an unreadable reply gets one retry asking for JSON only. */
export async function askForJson<T>(opts: {
  provider: LlmProvider
  model: string
  system: string
  content: string | ContentPart[]
  parse(value: Record<string, unknown>): T
  signal?: AbortSignal
}): Promise<{ value: T; usage: Usage }> {
  const messages: LlmMessage[] = [{ role: 'user', content: opts.content }]
  const request = (msgs: LlmMessage[]) => ({ model: opts.model, system: opts.system, messages: msgs })
  const first = await collect(opts.provider, request(messages), opts.signal)
  try {
    return { value: opts.parse(extractJson(first.text)), usage: first.usage }
  } catch {
    const retry = await collect(
      opts.provider,
      request([...messages, { role: 'assistant', content: first.text }, { role: 'user', content: RETRY }]),
      opts.signal,
    )
    return { value: opts.parse(extractJson(retry.text)), usage: addUsage(first.usage, retry.usage) }
  }
}
