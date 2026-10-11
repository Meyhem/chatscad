import type { RenderResult } from '../render/types'
import { applyEdits, parseReply } from './edits'
import { buildMessages, buildSystemPrompt, formatCompileErrors, type PromptContext } from './prompt'
import { DEFAULT_MAX_TOKENS, type ChatRequest, type ContentPart, type LlmMessage, type LlmProvider, type Usage } from './types'
import { addUsage, changedOutsideRange, scopeCorrection, scopeRejected, withCorrection } from './scope'

export interface GenerateResult {
  code: string | null // null when the reply had no usable code
  prose: string
  usage: Usage
  model: string
  /** M5: the reply strayed outside the picked part twice, so nothing was applied. */
  scopeRejected?: true
}

export type TurnEvent =
  | { type: 'delta'; text: string }
  | { type: 'reply'; result: GenerateResult; attempt: number } // attempt 0 = first reply, 1..N = auto-fix
  | { type: 'rendered'; result: RenderResult; attempt: number }
  | { type: 'fixing'; attempt: number; of: number; errors: string }
  | { type: 'gave-up'; attempts: number }
  | { type: 'retry' } // M5: a scoped reply strayed; the next deltas belong to a fresh reply

const FIX_REQUEST = 'The code did not compile. Fix the errors above.'

const fullFileRequest = (blockNumber: number) =>
  `SEARCH/REPLACE block ${blockNumber} did not match the current main.scad exactly, so nothing was changed. Reply with the complete updated file in one \`\`\`openscad block.`

async function streamText(
  provider: LlmProvider,
  req: ChatRequest,
  signal: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<{ text: string; usage: Usage }> {
  let text = ''
  let usage: Usage = { inputTokens: 0, outputTokens: 0 }
  for await (const event of provider.streamChat(req, signal)) {
    if (event.type === 'text') {
      text += event.delta
      onDelta?.(event.delta)
    } else {
      usage = event.usage
    }
  }
  return { text, usage }
}

function sumUsage(a: Usage, b: Usage): Usage {
  const reported = a.costUsd !== undefined || b.costUsd !== undefined
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(reported ? { costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) } : {}),
  }
}

/** Streams one reply, applies it to baseCode (full file or edits, with one full-file retry when an edit fails). */
async function generateUnscoped(opts: {
  provider: LlmProvider
  model: string
  history: LlmMessage[]
  userText: string | ContentPart[]
  ctx: PromptContext
  signal: AbortSignal
  onDelta?(text: string): void
  temperature?: number
}): Promise<GenerateResult> {
  const { provider, model, ctx, signal, onDelta, temperature } = opts
  const system = buildSystemPrompt(ctx)
  const messages = buildMessages(opts.history, opts.userText, ctx)
  const request = (msgs: LlmMessage[]): ChatRequest => ({
    model,
    system,
    messages: msgs,
    maxTokens: DEFAULT_MAX_TOKENS,
    ...(temperature !== undefined ? { temperature } : {}),
  })

  const first = await streamText(provider, request(messages), signal, onDelta)
  const parsed = parseReply(first.text)
  if (parsed.kind === 'full') return { code: parsed.code, prose: parsed.prose, usage: first.usage, model }
  if (parsed.kind === 'none') return { code: null, prose: parsed.prose, usage: first.usage, model }

  const applied = applyEdits(ctx.code, parsed.edits)
  if (applied.ok) return { code: applied.code, prose: parsed.prose, usage: first.usage, model }

  const retryMessages: LlmMessage[] = [
    ...messages,
    { role: 'assistant', content: first.text },
    { role: 'user', content: fullFileRequest(applied.failedIndex + 1) },
  ]
  const retry = await streamText(provider, request(retryMessages), signal, onDelta)
  const again = parseReply(retry.text)
  let code: string | null = null
  if (again.kind === 'full') code = again.code
  else if (again.kind === 'edits') {
    const second = applyEdits(ctx.code, again.edits)
    if (second.ok) code = second.code
  }
  return { code, prose: parsed.prose || again.prose, usage: sumUsage(first.usage, retry.usage), model }
}

/** generateCode → render → on failure send the errors back, up to maxFixAttempts. */
export async function runTurn(opts: {
  provider: LlmProvider
  model: string
  history: LlmMessage[]
  userText: string | ContentPart[]
  ctx: PromptContext
  maxFixAttempts: number
  render(code: string, signal: AbortSignal): Promise<RenderResult>
  apply(code: string, source: 'ai' | 'autofix'): void
  onEvent(e: TurnEvent): void
  signal: AbortSignal
}): Promise<void> {
  const { provider, model, ctx, maxFixAttempts, render, apply, onEvent, signal } = opts
  const generate = (history: LlmMessage[], userText: string | ContentPart[], context: PromptContext) =>
    generateCode({ provider, model, history, userText, ctx: context, signal, onDelta: (text) => onEvent({ type: 'delta', text }), onRetry: () => onEvent({ type: 'retry' }) })

  let history = opts.history
  let asked: string | ContentPart[] = opts.userText
  let attempt = 0
  let result = await generate(history, asked, ctx)
  onEvent({ type: 'reply', result, attempt })

  for (;;) {
    if (result.code === null) {
      if (attempt > 0) onEvent({ type: 'gave-up', attempts: attempt })
      return
    }
    // An abort (e.g. a manual edit) may land after the reply finished; never overwrite the user's code then.
    signal.throwIfAborted()
    apply(result.code, attempt === 0 ? 'ai' : 'autofix')
    const rendered = await render(result.code, signal)
    onEvent({ type: 'rendered', result: rendered, attempt })
    if (rendered.ok) return
    if (attempt >= maxFixAttempts) {
      onEvent({ type: 'gave-up', attempts: attempt })
      return
    }
    signal.throwIfAborted()

    const errors = formatCompileErrors(rendered)
    history = [...history, { role: 'user', content: asked }, { role: 'assistant', content: result.prose || 'Updated main.scad.' }]
    asked = FIX_REQUEST
    attempt += 1
    onEvent({ type: 'fixing', attempt, of: maxFixAttempts, errors })
    result = await generate(history, asked, { ...ctx, code: result.code, errors })
    onEvent({ type: 'reply', result, attempt })
  }
}

type GenerateOptions = Parameters<typeof generateUnscoped>[0] & {
  /** M5: called before a scoped reply is asked for again, so a streamed bubble can start over. */
  onRetry?(): void
}

/** Streams one reply, applies it to baseCode (full file or edits, with one full-file retry when an edit fails). M5: with a selection, a reply that changes other lines is retried once, then rejected. */
export async function generateCode(opts: GenerateOptions): Promise<GenerateResult> {
  const selection = opts.ctx.selection
  const first = await generateUnscoped(opts)
  if (!selection || opts.ctx.errors || first.code === null || !changedOutsideRange(opts.ctx.code, first.code, selection)) {
    return first
  }
  opts.onRetry?.()
  const retry = await generateUnscoped({ ...opts, userText: withCorrection(opts.userText, scopeCorrection(selection)) })
  const usage = addUsage(first.usage, retry.usage)
  if (retry.code !== null && !changedOutsideRange(opts.ctx.code, retry.code, selection)) return { ...retry, usage }
  return { code: null, prose: scopeRejected(selection), usage, model: retry.model, scopeRejected: true }
}
