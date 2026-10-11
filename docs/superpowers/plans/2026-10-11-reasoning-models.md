# Reasoning Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reasoning models are never cut off by an app-chosen token cap. Their reasoning streams into a collapsible box in the chat and is saved with the message. The user can pick the reasoning effort (Default, Off, Low, Medium, High) when the model supports it.

**Architecture:** Provider adapters gain two new `ChatEvent`s (`reasoning`, `notice`) and a `stopReason` on the final `usage` event. `runTurn` folds these into `GenerateResult` and forwards them as `TurnEvent`s. `sendPrompt` writes them to the chat store, which persists them to IndexedDB and project files. The UI adds a `ReasoningBox` in `MessageView`, an `EffortPicker` in the composer bar, and a cut-off callout. The effort choice is stored per profile and model on `ProviderProfile` and mapped to provider-specific request fields inside each adapter.

**Tech Stack:** TypeScript, React 19, Zustand, Dexie (IndexedDB), Vitest + Testing Library (jsdom; `// @vitest-environment node` for DB/fetch tests), Playwright, `@anthropic-ai/sdk` ^0.133, lucide-react icons, Tailwind v4 + `pc-*` component CSS.

**Spec:** `docs/superpowers/specs/2026-10-11-reasoning-models-design.md`

## Global Constraints

- TDD: write the failing test first, run it, watch it fail, then implement.
- Tokens only: no hex colours and no Tailwind palette classes in `src/` (`src/styles/noHardcodedColors.test.ts` enforces this). Use `var(--…)` tokens.
- Copy: sentence case, units on every number, no exclamation marks or emoji. Exact strings:
  - `Thinking · {d}`
  - `Thought for {d}`
  - ` · {n} tokens`
  - `Reasoning`
  - `The reply was cut off before it wrote any code`
  - `The model used its whole output allowance ({N} tokens) on reasoning. Try a lower effort or another model.`
  - `The model reached its output limit ({N} tokens).`
  - `This model ignored the reasoning setting.`
  - `This model can't turn reasoning off, so it used Low.`
  - Effort labels: `Default`, `Off`, `Low`, `Medium`, `High`. Captions: `The model decides`, `No reasoning, fastest`, `Faster, cheaper`, `Slower, more tokens`.
- Duration format: under 60 s, `{s} s` (for example `38 s`); otherwise `{m} min {s} s` (for example `1 min 52 s`). Token numbers use `toLocaleString('en-US')` (for example `14,210`).
- Model output is untrusted: reasoning renders only as a React text node. Never `inlineCode`, Markdown or `innerHTML`.
- The reasoning is never sent back to the model and never enters `useChatStore.history`.
- OpenAI-compatible requests send `max_tokens` only when `ChatRequest.maxTokens` is set. Test connection keeps `maxTokens: 16`, and the visual check keeps 200.
- Anthropic `max_tokens`: the model's `maxOutputTokens` from the cached model list, otherwise `64000`.
- `src/styles/tokens.css` is generated; do not edit it. `design/components.css` is a design source; put the new CSS in `src/index.css`.
- Commits: one per task, conventional messages, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Before each commit, `npm run typecheck`, `npm test` and `npm run e2e` must pass. Then push the current branch to `origin`.
  - The working tree contains the user's unrelated uncommitted layout work, including the untracked `e2e/tmp-debug.spec.ts`. Stage only the files named in the task (`git add <paths>`), never `git add -A`.
  - If `e2e/tmp-debug.spec.ts` or the WIP breaks a check, stop and ask the user. Do not edit or delete their files.

## Review Focus

1. **A model streams only reasoning, then stops normally with no text.** The reply keeps "The reply had no code." and the reasoning box shows what the model thought. Test in Task 4.
2. **The user presses Stop mid-reasoning.** The partial reasoning stays on the message, survives the "Stopped" path and is saved. Tests in Task 4 (store) and Task 5 (persistence).
3. **A scoped edit retries (`retry` event).** The first attempt's reasoning is cleared together with its text, so the box does not mix two attempts. Test in Task 4.
4. **A project file exported before this change** (messages without `reasoning*` keys) still imports. Test in Task 5.
5. **Reasoning that contains HTML** (`<img src=x onerror=alert(1)>`) renders as literal text. Test in Task 6.

---

### Task 1: Provider events carry stop reasons; no app-chosen token cap

**Files:**
- Modify: `src/ai/types.ts`
- Modify: `src/ai/openaiCompatible.ts`
- Modify: `src/ai/anthropic.ts`
- Modify: `src/ai/runTurn.ts:4,36-45,75` (the `streamText` loop and the request builder only)
- Modify: `src/refine/visualCheck.ts:47-50`
- Modify: `src/test/providers.ts`
- Test: `src/ai/openaiCompatible.test.ts`, `src/ai/anthropic.test.ts`

**Interfaces:**
- Produces (in `src/ai/types.ts`):
  ```ts
  export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'
  export type StopReason = 'end' | 'length' | 'other'
  export interface ChatRequest { model: string; system: string; messages: LlmMessage[]; maxTokens?: number; temperature?: number; reasoningEffort?: ReasoningEffort }
  export interface Usage { inputTokens: number; outputTokens: number; costUsd?: number; reasoningTokens?: number }
  export type ChatEvent =
    | { type: 'text'; delta: string }
    | { type: 'reasoning'; delta: string }
    | { type: 'notice'; text: string }
    | { type: 'usage'; usage: Usage; stopReason: StopReason }
  export interface ModelReasoning { efforts: boolean; canDisable: boolean; adaptive: boolean }
  export interface ModelInfo { id: string; name?: string; price?: ModelPrice; capabilities?: { vision: boolean; audio: boolean }; maxOutputTokens?: number; reasoning?: ModelReasoning }
  ```
  `DEFAULT_MAX_TOKENS` is deleted.
- Produces: `toStopReason(finish: string | null | undefined): StopReason` exported from `openaiCompatible.ts`.
- Produces: `ANTHROPIC_FALLBACK_MAX_TOKENS = 64000` and `anthropicStopReason(r: string | null | undefined): StopReason` exported from `anthropic.ts`.
- Produces: `scriptedProvider` replies accept `stopReason?: StopReason` and `reasoning?: string`.

- [ ] **Step 1: Write the failing tests**

In `src/ai/openaiCompatible.test.ts`, change the first test's expectations: the usage event gains `stopReason: 'end'`, and `max_tokens: 16000` is removed from the expected body. Then add:

```ts
it('omits max_tokens unless the request sets one', async () => {
  const { fetch, calls } = fakeFetch(sse('[DONE]'))
  await collect(provider(fetch).streamChat(REQ))
  expect(calls[0].body).not.toHaveProperty('max_tokens')
})

it('reports finish_reason "length" as a length stop and the reasoning tokens', async () => {
  const { fetch } = fakeFetch(
    sse(
      { choices: [{ index: 0, delta: { content: '' }, finish_reason: 'length' }] },
      { choices: [], usage: { prompt_tokens: 900, completion_tokens: 16000, completion_tokens_details: { reasoning_tokens: 16000 } } },
      '[DONE]',
    ),
  )
  expect((await collect(provider(fetch).streamChat(REQ))).at(-1)).toEqual({
    type: 'usage',
    usage: { inputTokens: 900, outputTokens: 16000, reasoningTokens: 16000 },
    stopReason: 'length',
  })
})

it('maps finish reasons', async () => {
  const { toStopReason } = await import('./openaiCompatible')
  expect(toStopReason('stop')).toBe('end')
  expect(toStopReason(null)).toBe('end')
  expect(toStopReason(undefined)).toBe('end')
  expect(toStopReason('length')).toBe('length')
  expect(toStopReason('content_filter')).toBe('other')
})
```

In the same file, update every other `{ type: 'usage', usage: … }` expectation to include `stopReason: 'end'`. In the non-streaming test (`sends a plain request…`), its JSON has no `finish_reason`, so `'end'` is right.

In `src/ai/anthropic.test.ts`:
- Change the first test's last event to `{ type: 'usage', usage: { inputTokens: 812, outputTokens: 498 }, stopReason: 'end' }`.
- Rename the second test to `'posts to /v1/messages with the browser-access header, max_tokens 64000 when the model is unknown, and no thinking or temperature'` and change `max_tokens: 16000` to `max_tokens: 64000` in it.
- Add:

```ts
it('reports stop_reason max_tokens as a length stop', async () => {
  const { fetch } = fakeFetch(sse(RECORDED_SSE.replace('"stop_reason":"end_turn"', '"stop_reason":"max_tokens"')))
  expect((await collect(provider(fetch).streamChat(REQ))).at(-1)).toMatchObject({ type: 'usage', stopReason: 'length' })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ai/openaiCompatible.test.ts src/ai/anthropic.test.ts`
Expected: FAIL. The bodies still contain `max_tokens: 16000`, there is no `stopReason`, and `toStopReason` is not exported.

- [ ] **Step 3: Implement**

`src/ai/types.ts`: apply the Interfaces block above. Keep the existing doc comments. Change the `maxTokens` comment to `// only when the caller needs a cap; adapters send none otherwise (Anthropic: the model's limit)`. Change the `streamChat` doc to `/** Yields text and reasoning deltas and notices, then exactly one usage event with the stop reason (zeros if the provider sent no usage). Throws ProviderError. */`. Delete `DEFAULT_MAX_TOKENS` and its comment.

`src/ai/openaiCompatible.ts`:
- Remove `DEFAULT_MAX_TOKENS` from the import and add `type StopReason`.
- Widen the wire types:

```ts
interface OpenAiUsage {
  prompt_tokens?: number
  completion_tokens?: number
  cost?: number
  completion_tokens_details?: { reasoning_tokens?: number } | null
}
interface OpenAiDelta {
  content?: string | null
  reasoning?: string | null
  reasoning_content?: string | null
}
interface OpenAiChunk {
  choices?: Array<{ delta?: OpenAiDelta; finish_reason?: string | null }>
  usage?: OpenAiUsage | null
  error?: unknown
}
interface OpenAiCompletion {
  choices?: Array<{ message?: OpenAiDelta; finish_reason?: string | null }>
  usage?: OpenAiUsage | null
}
```

```ts
export function toStopReason(finish: string | null | undefined): StopReason {
  if (finish === 'length') return 'length'
  return finish === 'stop' || finish === null || finish === undefined ? 'end' : 'other'
}

function toUsage(u: OpenAiUsage): Usage {
  const reasoning = u.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    ...(typeof u.cost === 'number' ? { costUsd: u.cost } : {}),
    ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {}),
  }
}
```

In `streamChat`, replace `max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,` with `...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),`. The non-streaming branch becomes:

```ts
const choice = reply.choices?.[0]
const text = choice?.message?.content ?? ''
if (text) yield { type: 'text', delta: text }
if (reply.usage) usage = toUsage(reply.usage)
yield { type: 'usage', usage, stopReason: toStopReason(choice?.finish_reason) }
return
```

In the streaming loop, declare `let finish: string | null | undefined` before the `try`, and inside the loop after the error check add:

```ts
const choice = chunk.choices?.[0]
if (choice?.finish_reason) finish = choice.finish_reason
const text = choice?.delta?.content
```

Replace the old `const text = chunk.choices?.[0]?.delta?.content` line with this. Change the final yield to `yield { type: 'usage', usage, stopReason: toStopReason(finish) }`.

`src/ai/anthropic.ts`:
- Remove `DEFAULT_MAX_TOKENS` from the import and add `type StopReason`.
- Add:

```ts
/** `max_tokens` is required; used when the model list did not report the model's limit. */
export const ANTHROPIC_FALLBACK_MAX_TOKENS = 64000

export function anthropicStopReason(r: string | null | undefined): StopReason {
  if (r === 'max_tokens') return 'length'
  return r === 'end_turn' || r === null || r === undefined ? 'end' : 'other'
}
```

In `streamChat`:
- Add `let stopReason: StopReason = 'end'`.
- Use `max_tokens: req.maxTokens ?? ANTHROPIC_FALLBACK_MAX_TOKENS`.
- In the `message_delta` branch, add `stopReason = anthropicStopReason(event.delta.stop_reason)`.
- Make the final yield `yield { type: 'usage', usage, stopReason }`.

`src/ai/runTurn.ts`:
- Remove `DEFAULT_MAX_TOKENS` from the import and delete `maxTokens: DEFAULT_MAX_TOKENS,` from `request()`.
- In `streamText`, replace `} else {\n      usage = event.usage\n    }` with `} else if (event.type === 'usage') {\n      usage = event.usage\n    }`. Task 3 extends this loop.

`src/refine/visualCheck.ts`: change `else usage = event.usage` to `else if (event.type === 'usage') usage = event.usage`.

`src/test/providers.ts`:

```ts
import type { ChatRequest, LlmProvider, ModelInfo, StopReason, Usage } from '../ai/types'

export interface ScriptedReply {
  text: string
  usage?: Usage
  reasoning?: string
  stopReason?: StopReason
}
```

In `streamChat`, before the text loop:

```ts
for (const piece of reply.reasoning?.match(/[\s\S]{1,8}/g) ?? []) yield { type: 'reasoning', delta: piece }
```

The final yield becomes `yield { type: 'usage', usage: reply.usage ?? { inputTokens: 100, outputTokens: 50 }, stopReason: reply.stopReason ?? 'end' }`.

Run `npm run typecheck`. Fix any remaining `ChatEvent` consumers it reports the same way (narrow on `event.type === 'usage'`). `src/settings/testConnection.ts` and `src/variants/temperatures.ts` should already compile.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ai src/refine src/settings`
Expected: PASS.

- [ ] **Step 5: Run every check and commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all pass. `e2e/ai-loop.spec.ts` still detects Test connection by `max_tokens === 16`, which is still sent.

```bash
git add src/ai/types.ts src/ai/openaiCompatible.ts src/ai/openaiCompatible.test.ts src/ai/anthropic.ts src/ai/anthropic.test.ts src/ai/runTurn.ts src/refine/visualCheck.ts src/test/providers.ts
git commit -m "fix: no app-chosen output cap, and providers report why a reply stopped

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

---

### Task 2: Adapters stream reasoning; Anthropic models report limits and thinking support

**Files:**
- Modify: `src/ai/openaiCompatible.ts`
- Modify: `src/ai/anthropic.ts`
- Modify: `src/ai/createProvider.ts`
- Test: `src/ai/openaiCompatible.test.ts`, `src/ai/anthropic.test.ts`, `src/ai/createProvider.test.ts` (only if it asserts the exact Anthropic options)

**Interfaces:**
- Consumes: the `ChatEvent`, `ModelInfo` and `ModelReasoning` types from Task 1.
- Produces: `AnthropicOptions.models?: ModelInfo[]`. `createProvider` passes `profile.cachedModels`.
- Produces: `anthropicModelInfo(m: { id: string; display_name?: string; max_tokens?: unknown; capabilities?: unknown }): ModelInfo`, exported from `anthropic.ts`.

- [ ] **Step 1: Write the failing tests**

`src/ai/openaiCompatible.test.ts`:

```ts
it('streams OpenRouter reasoning and DeepSeek reasoning_content as reasoning events, before the text', async () => {
  const { fetch } = fakeFetch(
    sse(
      { choices: [{ index: 0, delta: { reasoning: 'Wall is ' } }] },
      { choices: [{ index: 0, delta: { reasoning_content: '1.6 mm.' } }] },
      delta('Made it.'),
      '[DONE]',
    ),
  )
  expect(await collect(provider(fetch).streamChat(REQ))).toEqual([
    { type: 'reasoning', delta: 'Wall is ' },
    { type: 'reasoning', delta: '1.6 mm.' },
    { type: 'text', delta: 'Made it.' },
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end' },
  ])
})

it('yields the reasoning of a plain (non-streaming) reply', async () => {
  const { fetch } = fakeFetch(
    json(200, { choices: [{ message: { content: 'Done.', reasoning_content: 'Think.' }, finish_reason: 'stop' }] }),
  )
  expect(await collect(provider(fetch, 'sk', false).streamChat(REQ))).toEqual([
    { type: 'reasoning', delta: 'Think.' },
    { type: 'text', delta: 'Done.' },
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end' },
  ])
})
```

`src/ai/anthropic.test.ts`. The fixture builds a thinking stream from the recorded one:

```ts
const THINKING_SSE = RECORDED_SSE.replace(
  'event: content_block_start',
  [
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Wall is 1.6 mm."}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: content_block_start',
  ].join('\n'),
).replaceAll('"index":0,"delta":{"type":"text_delta"', '"index":1,"delta":{"type":"text_delta"')
  .replace('{"type":"content_block_start","index":0,"content_block":{"type":"text"', '{"type":"content_block_start","index":1,"content_block":{"type":"text"')
  .replace('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta', 'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\nevent: message_delta')

it('streams thinking deltas as reasoning events', async () => {
  const { fetch } = fakeFetch(sse(THINKING_SSE))
  const events = await collect(provider(fetch).streamChat(REQ))
  expect(events.slice(0, 3)).toEqual([
    { type: 'reasoning', delta: 'Wall is 1.6 mm.' },
    { type: 'text', delta: 'Made a ' },
    { type: 'text', delta: 'cube.' },
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
    baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test', fetch, maxRetries: 0,
    models: [{ id: 'claude-test', maxOutputTokens: 128000, reasoning: { efforts: true, canDisable: false, adaptive: true } }],
  })
  await collect(p.streamChat(REQ))
  const body = JSON.parse(String(calls[0].init.body))
  expect(body).toMatchObject({ max_tokens: 128000, thinking: { type: 'adaptive', display: 'summarized' } })
  expect(body).not.toHaveProperty('output_config')
})
```

Update the existing `'lists models with their display names'` test if its expected rows now differ. Rows without `max_tokens` or `capabilities` stay `{ id, name }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ai/openaiCompatible.test.ts src/ai/anthropic.test.ts`
Expected: FAIL. There are no reasoning events, `anthropicModelInfo` and the `models` option don't exist, and `max_tokens` is 64000.

- [ ] **Step 3: Implement**

`src/ai/openaiCompatible.ts`:

```ts
const reasoningOf = (d: OpenAiDelta | undefined): string => {
  const r = d?.reasoning ?? d?.reasoning_content
  return typeof r === 'string' ? r : ''
}
```

In the non-streaming branch, before `if (text) yield …`, add:

```ts
const thought = reasoningOf(choice?.message)
if (thought) yield { type: 'reasoning', delta: thought }
```

In the streaming loop, right after `if (choice?.finish_reason) finish = choice.finish_reason`, add:

```ts
const thought = reasoningOf(choice?.delta)
if (thought) yield { type: 'reasoning', delta: thought }
```

`src/ai/anthropic.ts`:

```ts
export interface AnthropicOptions {
  baseUrl: string
  apiKey: string
  fetch?: FetchLike
  /** SDK retries for 408/409/429/5xx and connection errors. Default 2; tests pass 0. */
  maxRetries?: number
  /** The profile's cached model list: output limits and thinking support per model. */
  models?: ModelInfo[]
}

/** True when the untyped capabilities tree has `supported: true` at `path`. */
function supported(node: unknown, ...path: string[]): boolean {
  let n: unknown = node
  for (const key of path) {
    if (typeof n !== 'object' || n === null) return false
    n = (n as Record<string, unknown>)[key]
  }
  return typeof n === 'object' && n !== null && (n as { supported?: unknown }).supported === true
}

export function anthropicModelInfo(m: { id: string; display_name?: string; max_tokens?: unknown; capabilities?: unknown }): ModelInfo {
  return {
    id: m.id,
    ...(typeof m.display_name === 'string' ? { name: m.display_name } : {}),
    ...(typeof m.max_tokens === 'number' && m.max_tokens > 0 ? { maxOutputTokens: m.max_tokens } : {}),
    ...(m.capabilities !== undefined
      ? {
          reasoning: {
            efforts: supported(m.capabilities, 'effort'),
            canDisable: supported(m.capabilities, 'thinking', 'types', 'disabled'),
            adaptive: supported(m.capabilities, 'thinking', 'types', 'adaptive'),
          },
        }
      : {}),
  }
}
```

In `listModels`, replace the push with `models.push(anthropicModelInfo(m as unknown as Parameters<typeof anthropicModelInfo>[0]))`.

In `streamChat`, build the params before calling the SDK:

```ts
const info = opts.models?.find((m) => m.id === req.model)
const params: Record<string, unknown> = {
  model: req.model,
  max_tokens: req.maxTokens ?? info?.maxOutputTokens ?? ANTHROPIC_FALLBACK_MAX_TOKENS,
  system: req.system,
  messages: req.messages.map(toAnthropicMessage),
  // Current models return empty thinking text unless asked for a summary.
  ...(info?.reasoning?.adaptive ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
}
const stream = getClient().messages.stream(params as unknown as Anthropic.MessageStreamParams, { signal })
```

Replace the comment `// No \`thinking\` and no \`temperature\`…` with `// No \`temperature\`: current Claude models reject sampling parameters.` In the event loop, add the branch:

```ts
} else if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
  yield { type: 'reasoning', delta: event.delta.thinking }
```

`src/ai/createProvider.ts`: `createAnthropicProvider({ baseUrl: profile.baseUrl, apiKey, models: profile.cachedModels })`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ai`
Expected: PASS. If `createProvider.test.ts` asserts the exact Anthropic options, add `models: profile.cachedModels` to its expectation.

- [ ] **Step 5: Run every check and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src/ai/openaiCompatible.ts src/ai/openaiCompatible.test.ts src/ai/anthropic.ts src/ai/anthropic.test.ts src/ai/createProvider.ts src/ai/createProvider.test.ts
git commit -m "feat: providers stream the model's reasoning; Claude uses each model's output limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

---

### Task 3: The turn runner carries reasoning, its duration, the stop reason, notices and the effort

**Files:**
- Modify: `src/ai/runTurn.ts`
- Test: `src/ai/runTurn.test.ts`

**Interfaces:**
- Consumes: `ChatEvent`, `StopReason`, `ReasoningEffort` (Task 1).
- Produces:
  ```ts
  export interface GenerateResult {
    code: string | null; prose: string; usage: Usage; model: string; scopeRejected?: true
    reasoning: string            // '' when none
    reasoningMs: number | null   // first reasoning delta → first text delta (or end of stream)
    stopReason: StopReason
  }
  export type TurnEvent = /* existing members */ | { type: 'reasoning'; text: string } | { type: 'notice'; text: string }
  // runTurn opts gain: reasoningEffort?: ReasoningEffort
  ```
  `generateCode` / `generateUnscoped` options gain `reasoningEffort?: ReasoningEffort`, `onReasoning?(text: string): void` and `onNotice?(text: string): void`. Every `ChatRequest` of a turn carries the effort: the first reply, the full-file retry, the scoped retry and auto-fix.

- [ ] **Step 1: Write the failing tests**

Add to `src/ai/runTurn.test.ts`, reusing its existing imports and helpers. If the file has no `run` helper, call `runTurn` directly as its existing tests do. Use `scriptedProvider` from `../test/providers` and `okResult` / `errorResult` from `../test/results`.

```ts
const CODE = 'Done.\n\n```openscad\ncube(1);\n```\n'
const BROKEN_CODE = 'Here.\n\n```openscad\ncube(1)\n```\n'

it('forwards reasoning deltas and puts the reasoning, its duration and the stop reason on the result', async () => {
  const events: TurnEvent[] = []
  vi.useFakeTimers({ now: 0 })
  const provider: LlmProvider = {
    listModels: async () => [],
    async *streamChat() {
      yield { type: 'reasoning', delta: 'Wall ' }
      vi.setSystemTime(4_000)
      yield { type: 'reasoning', delta: 'is 1.6 mm.' }
      vi.setSystemTime(7_500)
      yield { type: 'text', delta: CODE }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 }, stopReason: 'end' }
    },
  }
  await runTurn({
    provider, model: 'm', history: [], userText: 'A cube', ctx: { code: '' }, maxFixAttempts: 0,
    render: async () => okResult(), apply: () => {}, onEvent: (e) => events.push(e), signal: new AbortController().signal,
  })
  vi.useRealTimers()
  expect(events.filter((e) => e.type === 'reasoning')).toEqual([
    { type: 'reasoning', text: 'Wall ' },
    { type: 'reasoning', text: 'is 1.6 mm.' },
  ])
  const reply = events.find((e) => e.type === 'reply')
  expect(reply).toMatchObject({ result: { reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_500, stopReason: 'end', code: 'cube(1);\n' } })
})

it('reports no reasoning when the model sends none', async () => {
  const { provider } = scriptedProvider(CODE)
  const events: TurnEvent[] = []
  await runTurn({
    provider, model: 'm', history: [], userText: 'A cube', ctx: { code: '' }, maxFixAttempts: 0,
    render: async () => okResult(), apply: () => {}, onEvent: (e) => events.push(e), signal: new AbortController().signal,
  })
  expect(events.find((e) => e.type === 'reply')).toMatchObject({ result: { reasoning: '', reasoningMs: null, stopReason: 'end' } })
})

it('sends the reasoning effort on the first reply and on every auto-fix request', async () => {
  const { provider, requests } = scriptedProvider(BROKEN_CODE, CODE)
  await runTurn({
    provider, model: 'm', history: [], userText: 'A cube', ctx: { code: '' }, maxFixAttempts: 1, reasoningEffort: 'high',
    render: async (code) => (code.includes(';') ? okResult() : errorResult()), apply: () => {}, onEvent: () => {},
    signal: new AbortController().signal,
  })
  expect(requests.map((r) => r.reasoningEffort)).toEqual(['high', 'high'])
})

it('sends no effort field when the turn has none', async () => {
  const { provider, requests } = scriptedProvider(CODE)
  await runTurn({
    provider, model: 'm', history: [], userText: 'A cube', ctx: { code: '' }, maxFixAttempts: 0,
    render: async () => okResult(), apply: () => {}, onEvent: () => {}, signal: new AbortController().signal,
  })
  expect(requests[0]).not.toHaveProperty('reasoningEffort')
})

it('forwards provider notices as turn events', async () => {
  const events: TurnEvent[] = []
  const provider: LlmProvider = {
    listModels: async () => [],
    async *streamChat() {
      yield { type: 'notice', text: 'This model ignored the reasoning setting.' }
      yield { type: 'text', delta: CODE }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 }, stopReason: 'end' }
    },
  }
  await runTurn({
    provider, model: 'm', history: [], userText: 'A cube', ctx: { code: '' }, maxFixAttempts: 0,
    render: async () => okResult(), apply: () => {}, onEvent: (e) => events.push(e), signal: new AbortController().signal,
  })
  expect(events).toContainEqual({ type: 'notice', text: 'This model ignored the reasoning setting.' })
})

it('reports a length stop without code', async () => {
  const { provider } = scriptedProvider({ text: '', reasoning: 'Thinking hard', stopReason: 'length', usage: { inputTokens: 1, outputTokens: 16000 } })
  const events: TurnEvent[] = []
  await runTurn({
    provider, model: 'm', history: [], userText: 'A cube', ctx: { code: '' }, maxFixAttempts: 0,
    render: async () => okResult(), apply: () => {}, onEvent: (e) => events.push(e), signal: new AbortController().signal,
  })
  expect(events.find((e) => e.type === 'reply')).toMatchObject({ result: { code: null, stopReason: 'length', reasoning: 'Thinking hard' } })
})
```

`errorResult()` must produce a failed `RenderResult`. If its signature needs arguments, pass the arguments its other callers in `runTurn.test.ts` use. Add `import type { LlmProvider } from './types'` and `type TurnEvent` to the imports if they are missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ai/runTurn.test.ts`
Expected: FAIL. The result has no `reasoning` field and the new event types don't exist.

- [ ] **Step 3: Implement**

In `src/ai/runTurn.ts`, extend the imports with `type ReasoningEffort, type StopReason` and add the three fields to `GenerateResult` (Interfaces above). Extend `TurnEvent`:

```ts
  | { type: 'reasoning'; text: string }
  | { type: 'notice'; text: string } // the provider adjusted the request (effort dropped or lowered)
```

Replace `streamText`:

```ts
interface StreamCallbacks {
  onDelta?(text: string): void
  onReasoning?(text: string): void
  onNotice?(text: string): void
}

interface Streamed {
  text: string
  reasoning: string
  reasoningMs: number | null
  usage: Usage
  stopReason: StopReason
}

async function streamText(provider: LlmProvider, req: ChatRequest, signal: AbortSignal, on: StreamCallbacks): Promise<Streamed> {
  let text = ''
  let reasoning = ''
  let usage: Usage = { inputTokens: 0, outputTokens: 0 }
  let stopReason: StopReason = 'end'
  let startedAt: number | null = null
  let reasoningMs: number | null = null
  for await (const event of provider.streamChat(req, signal)) {
    switch (event.type) {
      case 'reasoning':
        startedAt ??= Date.now()
        reasoning += event.delta
        on.onReasoning?.(event.delta)
        break
      case 'text':
        if (startedAt !== null && reasoningMs === null) reasoningMs = Date.now() - startedAt
        text += event.delta
        on.onDelta?.(event.delta)
        break
      case 'notice':
        on.onNotice?.(event.text)
        break
      case 'usage':
        usage = event.usage
        stopReason = event.stopReason
        break
    }
  }
  if (startedAt !== null && reasoningMs === null) reasoningMs = Date.now() - startedAt
  return { text, reasoning, reasoningMs, usage, stopReason }
}

const joinReasoning = (a: string, b: string) => [a, b].filter((r) => r !== '').join('\n\n')
const addMs = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b)
```

`generateUnscoped`:
- Add `reasoningEffort?: ReasoningEffort`, `onReasoning?(text: string): void` and `onNotice?(text: string): void` to its options. Destructure `reasoningEffort, onReasoning, onNotice`.
- Add `...(reasoningEffort ? { reasoningEffort } : {}),` to `request()`.
- Call streamText as `streamText(provider, request(…), signal, { onDelta, onReasoning, onNotice })` in both places.
- Every `return` of a `GenerateResult` adds the reasoning fields. For the first reply:

```ts
const meta = { reasoning: first.reasoning, reasoningMs: first.reasoningMs, stopReason: first.stopReason }
if (parsed.kind === 'full') return { code: parsed.code, prose: parsed.prose, usage: first.usage, model, ...meta }
if (parsed.kind === 'none') return { code: null, prose: parsed.prose, usage: first.usage, model, ...meta }
…
if (applied.ok) return { code: applied.code, prose: parsed.prose, usage: first.usage, model, ...meta }
```

And for the full-file retry, which streams into the same bubble:

```ts
return {
  code,
  prose: parsed.prose || again.prose,
  usage: sumUsage(first.usage, retry.usage),
  model,
  reasoning: joinReasoning(first.reasoning, retry.reasoning),
  reasoningMs: addMs(first.reasoningMs, retry.reasoningMs),
  stopReason: retry.stopReason,
}
```

In `generateCode`, the scoped-rejection return becomes:

```ts
return {
  code: null, prose: scopeRejected(selection), usage, model: retry.model, scopeRejected: true,
  reasoning: retry.reasoning, reasoningMs: retry.reasoningMs, stopReason: retry.stopReason,
}
```

`runTurn`:
- Add `reasoningEffort?: ReasoningEffort` to its options.
- Change `generate` to:

```ts
const generate = (history: LlmMessage[], userText: string | ContentPart[], context: PromptContext) =>
  generateCode({
    provider, model, history, userText, ctx: context, signal,
    ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
    onDelta: (text) => onEvent({ type: 'delta', text }),
    onReasoning: (text) => onEvent({ type: 'reasoning', text }),
    onNotice: (text) => onEvent({ type: 'notice', text }),
    onRetry: () => onEvent({ type: 'retry' }),
  })
```

Run `npm run typecheck`. Places that build a `GenerateResult` literal by hand (tests, `src/variants`) need the three new fields. Add `reasoning: '', reasoningMs: null, stopReason: 'end'` to them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ai src/variants src/chat`
Expected: PASS.

- [ ] **Step 5: Run every check and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src/ai/runTurn.ts src/ai/runTurn.test.ts
# plus any test or variants file that only gained the three GenerateResult fields
git commit -m "feat: the turn runner passes reasoning, stop reason, notices and effort through

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

---

### Task 4: The chat keeps the reasoning and explains a cut-off reply

**Files:**
- Modify: `src/chat/chatStore.ts`
- Modify: `src/chat/sendPrompt.ts`
- Test: `src/chat/chatStore.test.ts`, `src/chat/sendPrompt.test.ts`

**Interfaces:**
- Consumes: `GenerateResult` and `TurnEvent` (Task 3).
- Produces (in `chatStore.ts`):
  ```ts
  // ChatMessage gains:
  reasoning?: string
  reasoningMs?: number
  reasoningTokens?: number
  reasoningStartedAt?: number // memory only: drives the live timer
  // ChatState gains:
  appendReasoning(id: string, delta: string): void
  ```
- Produces (in `sendPrompt.ts`): `export function cutOffCallout(result: GenerateResult): { title: string; body: string } | undefined`.

- [ ] **Step 1: Write the failing tests**

`src/chat/chatStore.test.ts`:

```ts
it('appends reasoning and stamps when it started', () => {
  vi.useFakeTimers({ now: 1_000 })
  const id = useChatStore.getState().addMessage({ role: 'assistant', text: '', turnLabel: null, model: 'm', usage: null, status: 'streaming' })
  useChatStore.getState().appendReasoning(id, 'Wall ')
  vi.setSystemTime(5_000)
  useChatStore.getState().appendReasoning(id, 'is 1.6 mm.')
  vi.useRealTimers()
  expect(useChatStore.getState().messages[0]).toMatchObject({ reasoning: 'Wall is 1.6 mm.', reasoningStartedAt: 1_000 })
})
```

`src/chat/sendPrompt.test.ts`:

```ts
it('keeps the reasoning, its duration and its tokens on the reply, and never sends it back to the model', async () => {
  const { provider } = scriptedProvider({ text: FULL, reasoning: 'Wall is 1.6 mm.', usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 12 } })
  await sendPrompt('A block', { createProvider: () => provider, render: async () => okResult() })
  const reply = chat().messages[1]!
  expect(reply).toMatchObject({ reasoning: 'Wall is 1.6 mm.', reasoningTokens: 12, status: 'done' })
  expect(typeof reply.reasoningMs).toBe('number')
  expect(JSON.stringify(chat().history)).not.toContain('1.6 mm')
})

it('shows a cut-off callout when the reply hit the output limit before any code', async () => {
  const { provider } = scriptedProvider({ text: '', reasoning: 'Hmm.', stopReason: 'length', usage: { inputTokens: 900, outputTokens: 16384 } })
  await sendPrompt('A block', { createProvider: () => provider, render: async () => okResult() })
  expect(chat().messages[1]).toMatchObject({
    text: '',
    status: 'done',
    error: {
      title: 'The reply was cut off before it wrote any code',
      body: 'The model used its whole output allowance (16,384 tokens) on reasoning. Try a lower effort or another model.',
    },
  })
})

it('words the cut-off without reasoning', async () => {
  const { provider } = scriptedProvider({ text: 'Let me', stopReason: 'length', usage: { inputTokens: 9, outputTokens: 4096 } })
  await sendPrompt('A block', { createProvider: () => provider, render: async () => okResult() })
  expect(chat().messages[1]!.error).toEqual({ title: 'The reply was cut off before it wrote any code', body: 'The model reached its output limit (4,096 tokens).' })
})

it('keeps "The reply had no code." and the reasoning when the model only reasoned', async () => {
  const { provider } = scriptedProvider({ text: '', reasoning: 'Just thoughts.' })
  await sendPrompt('A block', { createProvider: () => provider, render: async () => okResult() })
  expect(chat().messages[1]).toMatchObject({ text: 'The reply had no code.', reasoning: 'Just thoughts.' })
  expect(chat().messages[1]!.error).toBeUndefined()
})

it('adds each provider notice once per turn as a note', async () => {
  const provider: LlmProvider = {
    listModels: async () => [],
    async *streamChat() {
      yield { type: 'notice', text: 'This model ignored the reasoning setting.' }
      yield { type: 'text', delta: BROKEN }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' }
    },
  }
  let calls = 0
  const fixed: LlmProvider = {
    listModels: async () => [],
    async *streamChat(req, signal) {
      calls += 1
      if (calls === 1) yield* provider.streamChat(req, signal)
      else {
        yield { type: 'notice', text: 'This model ignored the reasoning setting.' }
        yield { type: 'text', delta: FIXED }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' }
      }
    },
  }
  await sendPrompt('A block', { createProvider: () => fixed, render: async (code) => (code.includes(';') ? okResult() : errorResult()) })
  expect(chat().messages.filter((m) => m.role === 'note' && m.text === 'This model ignored the reasoning setting.')).toHaveLength(1)
})

it('clears the first attempt reasoning when a scoped reply starts over', async () => {
  useChatStore.getState().addMessage({ role: 'assistant', text: '', turnLabel: null, model: null, usage: null, status: 'streaming' })
  const id = chat().messages[0]!.id
  useChatStore.getState().appendReasoning(id, 'old thoughts')
  useChatStore.getState().patchMessage(id, { text: '', reasoning: undefined, reasoningStartedAt: undefined })
  expect(chat().messages[0]!.reasoning).toBeUndefined()
})

it('keeps the partial reasoning when the user stops mid-reasoning', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const provider: LlmProvider = {
    listModels: async () => [],
    async *streamChat(_req, signal) {
      yield { type: 'reasoning', delta: 'Halfway there' }
      await gate
      signal?.throwIfAborted()
      throw new ProviderError('aborted', 'The request was stopped')
    },
  }
  const done = sendPrompt('A block', { createProvider: () => provider, render: async () => okResult() })
  await vi.waitFor(() => expect(chat().messages[1]?.reasoning).toBe('Halfway there'))
  stopTurn()
  release()
  await done
  expect(chat().messages[1]).toMatchObject({ status: 'done', reasoning: 'Halfway there', text: 'Stopped before the reply finished.' })
})
```

Add `import type { LlmProvider } from '../ai/types'` to the imports.

The scoped-retry test above only pins the store patch. Step 3's `retry` handler must issue exactly that patch: `{ text: '', reasoning: undefined, reasoningStartedAt: undefined }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/chat/chatStore.test.ts src/chat/sendPrompt.test.ts`
Expected: FAIL. `appendReasoning` is missing, there is no reasoning on messages, and there is no callout.

- [ ] **Step 3: Implement**

`src/chat/chatStore.ts`: add the four optional fields to `ChatMessage` with these comments:
- `reasoning?: string // the model's reasoning, shown collapsed; never sent back`
- `reasoningMs?: number`
- `reasoningTokens?: number`
- `reasoningStartedAt?: number // memory only: the live "Thinking · 38 s" timer`

Add `appendReasoning(id: string, delta: string): void` to `ChatState`, implemented as:

```ts
appendReasoning: (id, delta) =>
  set((s) => ({
    messages: s.messages.map((m) =>
      m.id === id ? { ...m, reasoning: (m.reasoning ?? '') + delta, reasoningStartedAt: m.reasoningStartedAt ?? Date.now() } : m,
    ),
  })),
```

`src/chat/sendPrompt.ts`:

```ts
import { runTurn, type GenerateResult, type TurnEvent } from '../ai/runTurn'

const CUT_OFF = 'The reply was cut off before it wrote any code'

/** The callout for a reply that hit the provider's output limit before it wrote any code. */
export function cutOffCallout(result: GenerateResult): { title: string; body: string } | undefined {
  if (result.stopReason !== 'length' || result.code !== null) return undefined
  const n = result.usage.outputTokens.toLocaleString('en-US')
  return {
    title: CUT_OFF,
    body: result.reasoning !== ''
      ? `The model used its whole output allowance (${n} tokens) on reasoning. Try a lower effort or another model.`
      : `The model reached its output limit (${n} tokens).`,
  }
}
```

In `sendPrompt`, next to `let checked = false`, add `const notices = new Set<string>()`. In `onEvent`:

```ts
case 'reasoning':
  store.appendReasoning(current, e.text)
  return
case 'notice':
  if (!notices.has(e.text)) {
    notices.add(e.text)
    store.addMessage(note(e.text))
  }
  return
case 'retry':
  store.patchMessage(current, { text: '', reasoning: undefined, reasoningStartedAt: undefined })
  return
```

The `reply` case becomes:

```ts
case 'reply': {
  const { result } = e
  const { cost, costSource } = computeCost(result.usage, priceFor(profile, result.model))
  const label = result.code !== null ? store.nextLabel(result.code) : null
  const cutOff = cutOffCallout(result)
  store.patchMessage(current, {
    text: result.prose || (result.code !== null ? 'Updated main.scad.' : cutOff ? '' : 'The reply had no code.'),
    status: 'done',
    turnLabel: label,
    model: result.model,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cost },
    ...(result.reasoningMs !== null ? { reasoningMs: result.reasoningMs } : {}),
    ...(result.usage.reasoningTokens !== undefined ? { reasoningTokens: result.usage.reasoningTokens } : {}),
    ...(cutOff ? { error: cutOff } : {}),
  })
  // …the rest of the case is unchanged
```

The abort path already keeps all other message fields, so the partial reasoning survives.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/chat`
Expected: PASS.

- [ ] **Step 5: Run every check and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src/chat/chatStore.ts src/chat/chatStore.test.ts src/chat/sendPrompt.ts src/chat/sendPrompt.test.ts
git commit -m "feat: replies keep the model's reasoning and explain a cut-off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

---

### Task 5: Reasoning is saved with the chat and travels in project files

**Files:**
- Modify: `src/db/db.ts:107-116` (`StoredMessage`)
- Modify: `src/history/chatPersistence.ts` (`toStored`, `fromStored`)
- Modify: `src/history/projectFile.ts:159-171` (parse) and `:222-224` (export)
- Test: `src/history/chatPersistence.test.ts`, `src/history/projectFile.test.ts`

**Interfaces:**
- Consumes: the `ChatMessage` reasoning fields (Task 4).
- Produces: `StoredMessage` gains optional `reasoning?: string | null`, `reasoningMs?: number | null` and `reasoningTokens?: number | null`. They are optional because rows written before this change lack them. No Dexie version bump, since they are not indexed.

- [ ] **Step 1: Write the failing tests**

`src/history/chatPersistence.test.ts`:

```ts
it('stores and restores the reasoning, and loads rows saved before reasoning existed', async () => {
  const { toStored, fromStored } = await import('./chatPersistence')
  const meta = { projectId: 'p', versionId: null, usageId: null, createdAt: 1 }
  const row = toStored(msg({ role: 'assistant', text: 'Done.', reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12, reasoningStartedAt: 99 }), meta)
  expect(row).toMatchObject({ reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12 })
  expect(row).not.toHaveProperty('reasoningStartedAt')
  expect(fromStored(row, undefined, undefined)).toMatchObject({ reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12 })
  expect(toStored(msg({}), meta)).toMatchObject({ reasoning: null, reasoningMs: null, reasoningTokens: null })
  const old = { ...row }
  delete old.reasoning
  delete old.reasoningMs
  delete old.reasoningTokens
  const restored = fromStored(old, undefined, undefined)
  expect(restored).not.toHaveProperty('reasoning')
  expect(restored).not.toHaveProperty('reasoningMs')
})

it('saves the partial reasoning of a stopped reply', async () => {
  const id = crypto.randomUUID()
  useChatStore.setState({ messages: [msg({ id, role: 'assistant', text: '', status: 'streaming', reasoning: 'Half' })] })
  useChatStore.getState().patchMessage(id, { status: 'done', text: 'Stopped before the reply finished.' })
  await chat.settled()
  expect(await db.messages.get(id)).toMatchObject({ reasoning: 'Half' })
})
```

`src/history/projectFile.test.ts`:

```ts
it('exports and imports the reasoning, and imports files that predate it', async () => {
  const project = await store().newProject({ name: 'R', code: 'cube(1);', origin: 'blank' })
  await putMessage({
    id: 'r1', projectId: project.id, versionId: null, role: 'assistant', content: 'Done.', imageBlobIds: [], audioTranscript: null,
    model: 'm', usageId: null, createdAt: 1, reasoning: '<b>Wall</b> is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12,
  })
  const file = await exportProject(project.id)
  expect(file.messages[0]).toMatchObject({ reasoning: '<b>Wall</b> is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12 })

  const result = await importFromText(JSON.stringify(file))
  if (!result.ok) throw new Error(result.error)
  const imported = await db.messages.where('projectId').equals(result.projects[0]!.id).toArray()
  expect(imported[0]).toMatchObject({ reasoning: '<b>Wall</b> is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12 })

  const legacy = JSON.parse(JSON.stringify(file)) as ProjectFile
  for (const m of legacy.messages as Array<Record<string, unknown>>) {
    delete m.reasoning
    delete m.reasoningMs
    delete m.reasoningTokens
  }
  const parsed = parseImport(legacy)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) expect(parsed.files[0]!.messages[0]).toMatchObject({ reasoning: null, reasoningMs: null, reasoningTokens: null })
})

it('rejects a reasoning that is not text', async () => {
  const project = await store().newProject({ name: 'R', code: 'cube(1);', origin: 'blank' })
  await putMessage({
    id: 'r2', projectId: project.id, versionId: null, role: 'assistant', content: 'Done.', imageBlobIds: [], audioTranscript: null,
    model: 'm', usageId: null, createdAt: 1,
  })
  const file = JSON.parse(JSON.stringify(await exportProject(project.id))) as ProjectFile
  ;(file.messages[0] as unknown as Record<string, unknown>).reasoning = 42
  expect(parseImport(file).ok).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/history/chatPersistence.test.ts src/history/projectFile.test.ts`
Expected: FAIL. The fields are neither stored nor exported, and the `putMessage` call does not type-check.

- [ ] **Step 3: Implement**

`src/db/db.ts`, inside `StoredMessage` after `usageId`:

```ts
  reasoning?: string | null // the model's reasoning; absent on rows saved before it was kept
  reasoningMs?: number | null
  reasoningTokens?: number | null
```

`src/history/chatPersistence.ts`. In `toStored`, add after `audioTranscript`:

```ts
    reasoning: m.reasoning ?? null,
    reasoningMs: m.reasoningMs ?? null,
    reasoningTokens: m.reasoningTokens ?? null,
```

In `fromStored`, add at the end of the object:

```ts
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(typeof m.reasoningMs === 'number' ? { reasoningMs: m.reasoningMs } : {}),
    ...(typeof m.reasoningTokens === 'number' ? { reasoningTokens: m.reasoningTokens } : {}),
```

`src/history/projectFile.ts`. In `parseProject`'s message map, add after `audioTranscript`:

```ts
      reasoning: x.reasoning === undefined ? null : strOrNull(x, 'reasoning', path, 400_000),
      reasoningMs: x.reasoningMs === undefined || x.reasoningMs === null ? null : num(x, 'reasoningMs', path),
      reasoningTokens: x.reasoningTokens === undefined || x.reasoningTokens === null ? null : num(x, 'reasoningTokens', path),
```

In `exportProject`'s message map, add to the object: `reasoning: m.reasoning ?? null, reasoningMs: m.reasoningMs ?? null, reasoningTokens: m.reasoningTokens ?? null,`. `importProjectFile` already spreads `...m`, so imports keep the fields.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/history src/db`
Expected: PASS.

- [ ] **Step 5: Run every check and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src/db/db.ts src/history/chatPersistence.ts src/history/chatPersistence.test.ts src/history/projectFile.ts src/history/projectFile.test.ts
git commit -m "feat: save the reasoning with the chat and in project files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

---

### Task 6: The reasoning box

**Files:**
- Create: `src/chat/ReasoningBox.tsx`
- Create: `src/chat/ReasoningBox.test.tsx`
- Modify: `src/chat/MessageView.tsx`
- Modify: `src/chat/MessageView.test.tsx`
- Modify: `src/ui/icons.ts` (add `Brain as IconBrain`, and `ChevronRight as IconChevronRight` if not exported yet)
- Modify: `src/index.css` (append a `@layer components` block)

**Interfaces:**
- Consumes: the `ChatMessage` reasoning fields (Task 4).
- Produces: `ReasoningBox({ message }: { message: ChatMessage })`, plus the exported helpers `formatDuration(ms: number): string` and `lastLine(text: string): string`.

- [ ] **Step 1: Write the failing tests**

`src/chat/ReasoningBox.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ChatMessage } from './chatStore'
import { formatDuration, lastLine, ReasoningBox } from './ReasoningBox'

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'r', role: 'assistant', text: '', turnLabel: null, model: 'm', usage: null, status: 'done', ...over,
})

it('formats durations with units', () => {
  expect(formatDuration(400)).toBe('0 s')
  expect(formatDuration(38_200)).toBe('38 s')
  expect(formatDuration(112_000)).toBe('1 min 52 s')
})

it('takes the last non-empty line', () => {
  expect(lastLine('one\ntwo  \n\n')).toBe('two')
  expect(lastLine('')).toBe('')
})

it('renders nothing without reasoning', () => {
  const { container } = render(<ReasoningBox message={msg({})} />)
  expect(container).toBeEmptyDOMElement()
})

it('while streaming: a ticking "Thinking" header and the newest line, shimmering, outside the closed box', () => {
  vi.useFakeTimers({ now: 10_000 })
  render(<ReasoningBox message={msg({ status: 'streaming', reasoning: 'Wall is 1.6 mm.\nSo the lid', reasoningStartedAt: 10_000 })} />)
  expect(screen.getByText('Thinking · 0 s')).toBeInTheDocument()
  const live = screen.getByText('So the lid')
  expect(live).toHaveClass('pc-reasoning-live', 'pc-shimmer')
  expect(live).toHaveAttribute('aria-hidden', 'true')
  act(() => vi.advanceTimersByTime(38_000))
  expect(screen.getByText('Thinking · 38 s')).toBeInTheDocument()
  vi.useRealTimers()
})

it('hides the live line once opened', () => {
  render(<ReasoningBox message={msg({ status: 'streaming', reasoning: 'a\nb', reasoningStartedAt: Date.now() })} />)
  const details = document.querySelector('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(document.querySelector('.pc-reasoning-live')).toBeNull()
})

it('when done: "Thought for" with tokens, collapsed, full text inside', () => {
  render(<ReasoningBox message={msg({ reasoning: 'Wall is 1.6 mm.\nDone.', reasoningMs: 112_000, reasoningTokens: 14_210 })} />)
  expect(screen.getByText('Thought for 1 min 52 s · 14,210 tokens')).toBeInTheDocument()
  expect(document.querySelector('details')).not.toHaveAttribute('open')
  expect(document.querySelector('.pc-reasoning-body')).toHaveTextContent('Wall is 1.6 mm. Done.')
  expect(document.querySelector('.pc-reasoning-live')).toBeNull()
})

it('says "Reasoning" when the duration is unknown', () => {
  render(<ReasoningBox message={msg({ reasoning: 'x' })} />)
  expect(screen.getByText('Reasoning')).toBeInTheDocument()
})

it('renders HTML in the reasoning as text', () => {
  render(<ReasoningBox message={msg({ reasoning: '<img src=x onerror=alert(1)>', reasoningMs: 1000 })} />)
  expect(document.querySelector('.pc-reasoning img')).toBeNull()
  expect(document.querySelector('.pc-reasoning-body')).toHaveTextContent('<img src=x onerror=alert(1)>')
})
```

`src/chat/MessageView.test.tsx`:

```tsx
it('shows the reasoning box above the reply text', () => {
  render(<MessageView message={reply({ reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_000 })} />)
  const box = screen.getByText('Thought for 7 s').closest('.pc-reasoning')!
  const body = screen.getByText('Made a 4-slot holder.')
  expect(box.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('drops the "Thinking…" status row once reasoning streams, and keeps "Writing code…"', () => {
  const { rerender } = render(<MessageView message={reply({ status: 'streaming', text: '', reasoning: 'Hmm', reasoningStartedAt: Date.now() })} />)
  expect(screen.queryByText('Thinking…')).toBeNull()
  rerender(<MessageView message={reply({ status: 'streaming', text: '```openscad\ncube(', reasoning: 'Hmm', reasoningStartedAt: Date.now() })} />)
  expect(screen.getByText('Writing code…')).toBeInTheDocument()
})

it('shows the cut-off callout', () => {
  render(<MessageView message={reply({ text: '', turnLabel: null, compileStatus: undefined, error: { title: 'The reply was cut off before it wrote any code', body: 'The model reached its output limit (4,096 tokens).' } })} />)
  expect(screen.getByRole('alert')).toHaveTextContent('The reply was cut off before it wrote any code')
})
```

If `streamingText('```openscad\ncube(')` does not report `writing: true`, use whatever partial-fence text the existing "Writing code…" test in `MessageView.test.tsx` uses.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/chat/ReasoningBox.test.tsx src/chat/MessageView.test.tsx`
Expected: FAIL. `./ReasoningBox` cannot be resolved.

- [ ] **Step 3: Implement**

`src/ui/icons.ts`: add `Brain as IconBrain,` and `ChevronRight as IconChevronRight,` (neither exists yet) to the lucide re-export list, in its alphabetical order.

`src/chat/ReasoningBox.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconBrain, IconChevronRight } from '../ui/icons'
import type { ChatMessage } from './chatStore'

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export function lastLine(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  return lines.at(-1) ?? ''
}

/** Date.now(), refreshed every second while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])
  return now
}

function header(message: ChatMessage, streaming: boolean, now: number): string {
  if (streaming && message.reasoningStartedAt !== undefined) return `Thinking · ${formatDuration(now - message.reasoningStartedAt)}`
  if (message.reasoningMs === undefined) return 'Reasoning'
  const tokens = message.reasoningTokens !== undefined ? ` · ${message.reasoningTokens.toLocaleString('en-US')} tokens` : ''
  return `Thought for ${formatDuration(message.reasoningMs)}${tokens}`
}

/** Full reasoning; follows new text while streaming unless the user scrolled up. */
function ReasoningBody({ text, follow }: { text: string; follow: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight
  }, [text, follow])
  return (
    <div
      ref={ref}
      className="pc-reasoning-body"
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
      }}
    >
      {text}
    </div>
  )
}

/** The model's reasoning, collapsed. Model output: text nodes only. */
export function ReasoningBox({ message }: { message: ChatMessage }) {
  const streaming = message.status === 'streaming'
  const [open, setOpen] = useState(false)
  const now = useNow(streaming)
  const reasoning = message.reasoning ?? ''
  if (reasoning === '') return null
  return (
    <div className="pc-reasoning">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <IconChevronRight className="pc-i pc-reasoning-chevron" aria-hidden="true" />
          <IconBrain className="pc-i" aria-hidden="true" />
          {header(message, streaming, now)}
        </summary>
        <ReasoningBody text={reasoning} follow={streaming} />
      </details>
      {streaming && !open && (
        <div className="pc-reasoning-live pc-shimmer" aria-hidden="true">
          {lastLine(reasoning)}
        </div>
      )}
    </div>
  )
}
```

`src/chat/MessageView.tsx`: import `ReasoningBox`. In the assistant branch, render `<ReasoningBox message={message} />` as the first child of `.pc-msg.is-assistant`. Then change the streaming status row so it renders only when `writing || !message.reasoning`:

```tsx
{streaming ? (
  (writing || !message.reasoning) && (
    <div className="pc-row pc-caption">
      <IconSpinner className="pc-i motion-safe:animate-spin" aria-hidden="true" />
      {writing ? 'Writing code…' : 'Thinking…'}
    </div>
  )
) : (
  message.status === 'done' && <MetaLine message={message} />
)}
```

`src/index.css`: append:

```css
@layer components {
  .pc-reasoning { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--inset); min-width: 0; }
  .pc-reasoning summary { display: flex; align-items: center; gap: var(--space-2); padding: 6px var(--space-3); font-size: 12px; line-height: 16px; color: var(--ink-muted); cursor: pointer; list-style: none; user-select: none; }
  .pc-reasoning summary::-webkit-details-marker { display: none; }
  .pc-reasoning summary:hover { color: var(--ink); }
  .pc-reasoning summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; border-radius: var(--radius-md); }
  .pc-reasoning-chevron { transition: transform 150ms ease; }
  .pc-reasoning details[open] .pc-reasoning-chevron { transform: rotate(90deg); }
  .pc-reasoning-body { border-top: 1px solid var(--line); padding: var(--space-2) var(--space-3); font: 400 12px/18px var(--font-mono); color: var(--ink-muted); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 216px; overflow-y: auto; }
  .pc-reasoning-live { padding: 0 var(--space-3) var(--space-2) 34px; font: 400 12px/18px var(--font-mono); color: var(--ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pc-shimmer { background: linear-gradient(90deg, var(--ink-muted) 40%, var(--ink) 50%, var(--ink-muted) 60%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: pc-shimmer 2.2s linear infinite; }
  @keyframes pc-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
  @media (prefers-reduced-motion: reduce) {
    .pc-shimmer { animation: none; background: none; color: var(--ink-muted); }
    .pc-reasoning-chevron { transition: none; }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/chat src/styles`
Expected: PASS, including `noHardcodedColors.test.ts`.

- [ ] **Step 5: Run every check and commit**

The visual check of the box happens in Task 9, which saves a screenshot.

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src/chat/ReasoningBox.tsx src/chat/ReasoningBox.test.tsx src/chat/MessageView.tsx src/chat/MessageView.test.tsx src/ui/icons.ts src/index.css
git commit -m "feat: show the model's reasoning in a collapsible box with a live line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

---

### Task 7: Adapters send the reasoning effort

**Files:**
- Modify: `src/ai/url.ts` (add `isOpenRouter`)
- Modify: `src/settings/useModelList.ts:14-17` (use `isOpenRouter`)
- Modify: `src/ai/openaiCompatible.ts`
- Modify: `src/ai/anthropic.ts`
- Test: `src/ai/url.test.ts`, `src/ai/openaiCompatible.test.ts`, `src/ai/anthropic.test.ts`

**Interfaces:**
- Consumes: `ChatRequest.reasoningEffort`, `ModelReasoning` and the `notice` event (Task 1).
- Produces: `isOpenRouter(baseUrl: string): boolean` in `url.ts`.
- Produces: `effortBody(effort: ReasoningEffort | undefined, openRouter: boolean): Record<string, unknown>` and `EFFORT_IGNORED = 'This model ignored the reasoning setting.'` in `openaiCompatible.ts`.
- Produces: `EFFORT_OFF_UNSUPPORTED = "This model can't turn reasoning off, so it used Low."` in `anthropic.ts`.

- [ ] **Step 1: Write the failing tests**

`src/ai/url.test.ts`:

```ts
it('recognises OpenRouter by host', () => {
  expect(isOpenRouter('https://openrouter.ai/api/v1')).toBe(true)
  expect(isOpenRouter('https://api.openai.com/v1')).toBe(false)
  expect(isOpenRouter('not a url')).toBe(false)
})
```

Add `isOpenRouter` to that file's import from `./url`.

`src/ai/openaiCompatible.test.ts`:

```ts
it('maps effort to OpenRouter reasoning and to reasoning_effort elsewhere', async () => {
  const { effortBody } = await import('./openaiCompatible')
  expect(effortBody(undefined, true)).toEqual({})
  expect(effortBody('high', true)).toEqual({ reasoning: { effort: 'high' } })
  expect(effortBody('off', true)).toEqual({ reasoning: { enabled: false } })
  expect(effortBody('low', false)).toEqual({ reasoning_effort: 'low' })
  expect(effortBody('off', false)).toEqual({ reasoning_effort: 'none' })
})

it('sends the effort in the request body', async () => {
  const { fetch, calls } = fakeFetch(sse('[DONE]'), sse('[DONE]'))
  await collect(provider(fetch).streamChat({ ...REQ, reasoningEffort: 'medium' }))
  expect(calls[0].body).toMatchObject({ reasoning_effort: 'medium' })
  const or = createOpenAiCompatibleProvider({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', fetch })
  await collect(or.streamChat({ ...REQ, reasoningEffort: 'medium' }))
  expect(calls[1].body).toMatchObject({ reasoning: { effort: 'medium' } })
})

it('drops a rejected effort, retries once and says so', async () => {
  const { fetch, calls } = fakeFetch(
    json(400, { error: { message: 'Unrecognized request argument supplied: reasoning_effort' } }),
    sse(delta('Done.'), '[DONE]'),
  )
  const events = await collect(provider(fetch).streamChat({ ...REQ, reasoningEffort: 'high' }))
  expect(calls).toHaveLength(2)
  expect(calls[1].body).not.toHaveProperty('reasoning_effort')
  expect(events[0]).toEqual({ type: 'notice', text: 'This model ignored the reasoning setting.' })
})

it('marks OpenRouter models that accept reasoning', async () => {
  const { fetch } = fakeFetch(
    json(200, { data: [{ id: 'r1', supported_parameters: ['reasoning', 'max_tokens'] }, { id: 'plain', supported_parameters: ['max_tokens'] }, { id: 'unknown' }] }),
  )
  const models = await provider(fetch).listModels()
  expect(models.find((m) => m.id === 'r1')?.reasoning).toEqual({ efforts: true, canDisable: true, adaptive: false })
  expect(models.find((m) => m.id === 'plain')?.reasoning).toEqual({ efforts: false, canDisable: false, adaptive: false })
  expect(models.find((m) => m.id === 'unknown')).not.toHaveProperty('reasoning')
})
```

In the `relaxRequest` describe block:

```ts
it('drops the reasoning fields when the server names them', () => {
  expect(relaxRequest({ model: 'x', reasoning_effort: 'low' }, 'unknown field reasoning_effort')).toEqual({ model: 'x' })
  expect(relaxRequest({ model: 'x', reasoning: { effort: 'low' } }, '"reasoning" is not allowed')).toEqual({ model: 'x' })
})
```

`src/ai/anthropic.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ai`
Expected: FAIL. `isOpenRouter` and `effortBody` don't exist, there is no effort in the bodies, and there is no fallback.

- [ ] **Step 3: Implement**

`src/ai/url.ts`:

```ts
export function isOpenRouter(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai'
  } catch {
    return false
  }
}
```

`src/settings/useModelList.ts`: replace the inline `new URL(baseUrl).hostname === 'openrouter.ai'` with `isOpenRouter(baseUrl)`, importing it from `../ai/url`. Keep the surrounding `try` if it guards `isLocalBaseUrl` too.

`src/ai/openaiCompatible.ts`:

```ts
import { isOpenRouter, joinUrl, type FetchLike } from './url'

export const EFFORT_IGNORED = 'This model ignored the reasoning setting.'

/** Request fields for an effort: OpenRouter's `reasoning` object, else OpenAI's `reasoning_effort`. Default sends nothing. */
export function effortBody(effort: ReasoningEffort | undefined, openRouter: boolean): Body {
  if (!effort) return {}
  if (openRouter) return { reasoning: effort === 'off' ? { enabled: false } : { effort } }
  return { reasoning_effort: effort === 'off' ? 'none' : effort }
}
```

In `relaxRequest`, insert after the `stream_options` branch:

```ts
  if (('reasoning' in next || 'reasoning_effort' in next) && /reasoning/.test(errorText)) {
    delete next.reasoning
    delete next.reasoning_effort
    return next
  }
```

Change `postChat` to return the body it finally sent:

```ts
async function postChat(url: string, body: Body, signal?: AbortSignal): Promise<{ res: Response; sent: Body }> {
  for (let attempt = 0; ; attempt++) {
    const res = await send(url, { method: 'POST', headers: headers(true), body: JSON.stringify(body) }, signal)
    if (res.ok) return { res, sent: body }
    …unchanged
  }
}
```

In `streamChat`:
- Add `...effortBody(req.reasoningEffort, isOpenRouter(opts.baseUrl)),` to the body.
- Then:

```ts
const { res, sent } = await postChat(url, body, signal)
if (req.reasoningEffort && !('reasoning' in sent) && !('reasoning_effort' in sent)) yield { type: 'notice', text: EFFORT_IGNORED }
```

Add `type ReasoningEffort` to the imports from `./types`. In `listModels`, extend `OpenAiModel` with `supported_parameters?: unknown`, and inside the `flatMap`:

```ts
const params = m.supported_parameters
const reasoning = Array.isArray(params)
  ? { efforts: params.includes('reasoning'), canDisable: params.includes('reasoning'), adaptive: false }
  : null
```

Spread `...(reasoning ? { reasoning } : {})` into the returned object.

`src/ai/anthropic.ts`:

```ts
export const EFFORT_OFF_UNSUPPORTED = "This model can't turn reasoning off, so it used Low."

function thinkingParams(effort: ReasoningEffort | undefined, info: ModelInfo | undefined): Record<string, unknown> {
  if (effort === 'off') return { thinking: { type: 'disabled' } }
  if (effort) return { thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort } }
  // Current models return empty thinking text unless asked for a summary.
  return info?.reasoning?.adaptive ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}
}
```

Move the existing body of `streamChat` into a local generator `async function* streamOnce(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent>` inside `createAnthropicProvider`. In its `params`, replace the Task 2 `...(info?.reasoning?.adaptive ? … : {})` line with `...thinkingParams(req.reasoningEffort, info),`. Then:

```ts
async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  try {
    yield* streamOnce(req, signal)
  } catch (err) {
    // Some models (Opus 5.5, Sonnet 5.5) cannot turn thinking off; the 400 comes before any event.
    if (req.reasoningEffort === 'off' && err instanceof ProviderError && err.kind === 'bad-request' && /thinking/i.test(err.message)) {
      yield { type: 'notice', text: EFFORT_OFF_UNSUPPORTED }
      yield* streamOnce({ ...req, reasoningEffort: 'low' }, signal)
      return
    }
    throw err
  }
},
```

Add `type ReasoningEffort` to the imports from `./types`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ai src/settings`
Expected: PASS.

- [ ] **Step 5: Run every check and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src/ai/url.ts src/ai/url.test.ts src/settings/useModelList.ts src/ai/openaiCompatible.ts src/ai/openaiCompatible.test.ts src/ai/anthropic.ts src/ai/anthropic.test.ts
git commit -m "feat: send the reasoning effort to OpenRouter, OpenAI-style servers and Claude

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

---

### Task 8: Choosing the effort

**Files:**
- Create: `src/ai/effort.ts`, `src/ai/effort.test.ts`
- Create: `src/chat/EffortPicker.tsx`, `src/chat/EffortPicker.test.tsx`
- Modify: `src/db/db.ts:6-19` (`ProviderProfile`)
- Modify: `src/settings/providersStore.ts`
- Modify: `src/chat/Composer.tsx:72`
- Modify: `src/chat/sendPrompt.ts` (the `runTurn` call)
- Modify: `src/variants/runVariants.ts` (the `runTurn` call)
- Test: `src/chat/sendPrompt.test.ts`, `src/variants/runVariants.test.ts`

**Interfaces:**
- Consumes: `ReasoningEffort`, `ModelReasoning`, and `runTurn`'s `reasoningEffort` option (Tasks 1 and 3).
- Produces:
  ```ts
  // src/db/db.ts ProviderProfile gains:
  reasoningEffort?: Record<string, ReasoningEffort> // model id → choice; missing = Default
  // src/ai/effort.ts
  export function effortFor(profile: ProviderProfile, model: string): ReasoningEffort | undefined
  export function reasoningSupport(profile: ProviderProfile, model: string): { efforts: boolean; canDisable: boolean }
  export function withEffort(profile: ProviderProfile, model: string, effort: ReasoningEffort | null): Record<string, ReasoningEffort>
  // providersStore
  setReasoningEffort(profileId: string, model: string, effort: ReasoningEffort | null): Promise<void>
  ```

- [ ] **Step 1: Write the failing tests**

`src/ai/effort.test.ts`:

```ts
import { newProfile } from '../db/profiles'
import { effortFor, reasoningSupport, withEffort } from './effort'

const base = newProfile({ name: 'OR', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'r1' })
const profile = {
  ...base,
  cachedModels: [{ id: 'r1', reasoning: { efforts: true, canDisable: false, adaptive: false } }, { id: 'plain' }],
  reasoningEffort: { r1: 'high' as const },
}

it('reads the stored effort per model', () => {
  expect(effortFor(profile, 'r1')).toBe('high')
  expect(effortFor(profile, 'plain')).toBeUndefined()
  expect(effortFor(base, 'r1')).toBeUndefined()
})

it('reports what the model supports, unknown counting as no', () => {
  expect(reasoningSupport(profile, 'r1')).toEqual({ efforts: true, canDisable: false })
  expect(reasoningSupport(profile, 'plain')).toEqual({ efforts: false, canDisable: false })
  expect(reasoningSupport(profile, 'typed-in')).toEqual({ efforts: false, canDisable: false })
})

it('sets and clears a choice without touching other models', () => {
  expect(withEffort(profile, 'plain', 'low')).toEqual({ r1: 'high', plain: 'low' })
  expect(withEffort(profile, 'r1', null)).toEqual({})
})
```

`src/chat/EffortPicker.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../db/db'
import { newProfile } from '../db/profiles'
import { useProvidersStore } from '../settings/providersStore'
import { EffortPicker } from './EffortPicker'

function setup(reasoning: { efforts: boolean; canDisable: boolean; adaptive: boolean } | undefined, chosen?: 'low') {
  const profile = {
    ...newProfile({ name: 'OR', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'r1' }),
    cachedModels: [{ id: 'r1', ...(reasoning ? { reasoning } : {}) }],
    ...(chosen ? { reasoningEffort: { r1: chosen } } : {}),
  }
  const setReasoningEffort = vi.fn(async () => {})
  useProvidersStore.setState({
    loaded: true,
    profiles: [profile],
    settings: { ...DEFAULT_SETTINGS, activeProfileId: profile.id, activeModel: 'r1' },
    setReasoningEffort,
  })
  return { profile, setReasoningEffort }
}

it('is hidden when the model does not support effort', () => {
  setup(undefined)
  const { container } = render(<EffortPicker />)
  expect(container).toBeEmptyDOMElement()
})

it('shows Default, opens a menu with captions, and stores the choice', () => {
  const { profile, setReasoningEffort } = setup({ efforts: true, canDisable: true, adaptive: false })
  render(<EffortPicker />)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Default' }))
  expect(screen.getByRole('menuitemradio', { name: /Default/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitemradio', { name: /Off/ })).toHaveTextContent('No reasoning, fastest')
  expect(screen.getByRole('menuitemradio', { name: /High/ })).toHaveTextContent('Slower, more tokens')
  fireEvent.click(screen.getByRole('menuitemradio', { name: /High/ }))
  expect(setReasoningEffort).toHaveBeenCalledWith(profile.id, 'r1', 'high')
  expect(screen.queryByRole('menu')).toBeNull()
})

it('hides Off when the model cannot turn reasoning off, and shows the current choice', () => {
  setup({ efforts: true, canDisable: false, adaptive: true }, 'low')
  render(<EffortPicker />)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Low' }))
  expect(screen.queryByRole('menuitemradio', { name: /Off/ })).toBeNull()
  expect(screen.getByRole('menuitemradio', { name: /Low/ })).toHaveAttribute('aria-checked', 'true')
})

it('choosing Default clears the stored choice; Escape closes', () => {
  const { profile, setReasoningEffort } = setup({ efforts: true, canDisable: true, adaptive: false }, 'low')
  render(<EffortPicker />)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Low' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Default/ }))
  expect(setReasoningEffort).toHaveBeenCalledWith(profile.id, 'r1', null)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Low' }))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})

it('moves focus with the arrow keys', () => {
  setup({ efforts: true, canDisable: true, adaptive: false })
  render(<EffortPicker />)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Default' }))
  const items = screen.getAllByRole('menuitemradio')
  expect(items[0]).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
  expect(items[1]).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
  expect(items.at(-1)).toHaveFocus()
})
```

`src/chat/sendPrompt.test.ts`:

```ts
it('sends the stored effort for the active model', async () => {
  useProvidersStore.setState((s) => ({ profiles: s.profiles.map((p) => ({ ...p, reasoningEffort: { 'test-model': 'low' as const } })) }))
  const { provider, requests } = scriptedProvider(FULL)
  await sendPrompt('A block', { createProvider: () => provider, render: async () => okResult() })
  expect(requests[0].reasoningEffort).toBe('low')
})
```

`src/variants/runVariants.test.ts`: add a test next to the existing ones that gives `req.profile` a `reasoningEffort: { [slotModel]: 'medium' }`, where `slotModel` is the model of the first slot in that file's fixture. It asserts that the fake `deps.runTurn` received `reasoningEffort: 'medium'` for that slot. Use the file's existing fixture builders and fake `runTurn`. The assertion is:

```ts
expect(runTurnCalls[0]).toMatchObject({ reasoningEffort: 'medium' })
```

Here `runTurnCalls` is the array the file's fake `deps.runTurn` records into. If the fake does not record its options yet, make it push `opts` into such an array.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ai/effort.test.ts src/chat/EffortPicker.test.tsx src/chat/sendPrompt.test.ts src/variants`
Expected: FAIL. The modules are missing and no effort is sent.

- [ ] **Step 3: Implement**

`src/db/db.ts`: add `import type { ReasoningEffort } from '../ai/types'` (extend the existing `../ai/types` import if there is one). In `ProviderProfile`, after `priceTable`, add `reasoningEffort?: Record<string, ReasoningEffort> // model id → choice; missing = Default`.

`src/ai/effort.ts`:

```ts
import type { ProviderProfile } from '../db/db'
import type { ReasoningEffort } from './types'

/** The effort chosen for this profile and model; undefined is Default (send nothing). */
export function effortFor(profile: ProviderProfile, model: string): ReasoningEffort | undefined {
  return profile.reasoningEffort?.[model]
}

/** What the model accepts, from the cached model list. Unknown counts as no. */
export function reasoningSupport(profile: ProviderProfile, model: string): { efforts: boolean; canDisable: boolean } {
  const r = profile.cachedModels.find((m) => m.id === model)?.reasoning
  return { efforts: r?.efforts ?? false, canDisable: r?.canDisable ?? false }
}

export function withEffort(profile: ProviderProfile, model: string, effort: ReasoningEffort | null): Record<string, ReasoningEffort> {
  const next = { ...profile.reasoningEffort }
  if (effort === null) delete next[model]
  else next[model] = effort
  return next
}
```

`src/settings/providersStore.ts`:
- Add `setReasoningEffort(profileId: string, model: string, effort: ReasoningEffort | null): Promise<void>` to `ProvidersState`.
- Implement it after `chooseModel`:

```ts
setReasoningEffort: async (profileId, model, effort) => {
  const profile = get().profiles.find((p) => p.id === profileId)
  if (!profile) return
  await get().updateProfile(profileId, { reasoningEffort: withEffort(profile, model, effort) })
},
```

- Import `withEffort` from `../ai/effort` and `type ReasoningEffort` from `../ai/types`.

`src/chat/EffortPicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { effortFor, reasoningSupport } from '../ai/effort'
import type { ReasoningEffort } from '../ai/types'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { IconBrain, IconCheck, IconChevron } from '../ui/icons'

type Choice = ReasoningEffort | null

const OPTIONS: Array<{ value: Choice; label: string; caption?: string }> = [
  { value: null, label: 'Default', caption: 'The model decides' },
  { value: 'off', label: 'Off', caption: 'No reasoning, fastest' },
  { value: 'low', label: 'Low', caption: 'Faster, cheaper' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High', caption: 'Slower, more tokens' },
]

/** Reasoning effort for the active model; only for models that report support. */
export function EffortPicker() {
  const profile = useProvidersStore(selectActiveProfile)
  const model = useProvidersStore(selectActiveModel)
  const setReasoningEffort = useProvidersStore((s) => s.setReasoningEffort)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!profile || !model) return null
  const support = reasoningSupport(profile, model)
  if (!support.efforts) return null
  const current: Choice = effortFor(profile, model) ?? null
  const options = OPTIONS.filter((o) => o.value !== 'off' || support.canDisable)
  const label = OPTIONS.find((o) => o.value === current)?.label ?? 'Default'

  const move = (step: number) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + step + items.length) % items.length]?.focus()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="pc-model"
        aria-label={`Reasoning effort: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <IconBrain className="pc-i" aria-hidden="true" />
        {label}
        <IconChevron className="pc-i" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Reasoning effort"
          className="absolute bottom-full left-0 z-10 mb-2 flex w-56 flex-col gap-0.5 rounded-lg border border-line bg-panel-raised p-1 shadow-pop"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
          }}
        >
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === current}
              className="grid grid-cols-[16px_1fr] gap-x-1.5 rounded-sm px-2 py-1.5 text-left text-[13px] text-ink hover:bg-panel aria-checked:bg-accent-soft"
              onClick={() => {
                void setReasoningEffort(profile.id, model, o.value)
                setOpen(false)
              }}
            >
              <span>{o.value === current && <IconCheck className="pc-i" aria-hidden="true" />}</span>
              <span>
                {o.label}
                {o.caption && <span className="pc-caption block">{o.caption}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

All the utilities used here (`bg-accent-soft`, `bg-panel`, `bg-panel-raised`, `text-ink`, `border-line`, `shadow-pop`) are existing token utilities. `ModelCombobox.tsx` uses the same `hover:bg-panel aria-selected:bg-accent-soft` pattern.

`src/chat/Composer.tsx`: import `EffortPicker` and render `<EffortPicker />` right after `<ModelPicker />`.

`src/chat/sendPrompt.ts`: import `effortFor` from `../ai/effort`. In the `runTurn({...})` call, add after `model,`:

```ts
...(effortFor(profile, model) ? { reasoningEffort: effortFor(profile, model) } : {}),
```

`src/variants/runVariants.ts`: in the `deps.runTurn({...})` call, add after `model: slot.model,`:

```ts
...(req.profile.reasoningEffort?.[slot.model] ? { reasoningEffort: req.profile.reasoningEffort[slot.model] } : {}),
```

If `runVariants`'s `deps.runTurn` type is declared separately, widen it to include `reasoningEffort?: ReasoningEffort`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ai src/chat src/variants src/settings`
Expected: PASS.

- [ ] **Step 5: Check it in the browser**

`preview_start` the dev server. In `javascript_tool`, give the active profile a reasoning-capable cached model through IndexedDB, the same way `seedFakeProvider` does: put a profile whose `cachedModels` is `[{ id: 'fake-model', reasoning: { efforts: true, canDisable: true, adaptive: false } }]`. Then reload. Confirm "Default" appears next to the model picker, the menu opens upward with five options and their captions, and choosing High updates the button. Take a screenshot as proof.

- [ ] **Step 6: Run every check and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src/ai/effort.ts src/ai/effort.test.ts src/chat/EffortPicker.tsx src/chat/EffortPicker.test.tsx src/db/db.ts src/settings/providersStore.ts src/chat/Composer.tsx src/chat/sendPrompt.ts src/chat/sendPrompt.test.ts src/variants/runVariants.ts src/variants/runVariants.test.ts
git commit -m "feat: choose the reasoning effort per model in the composer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

---

### Task 9: End-to-end — reasoning streams, shows, persists; effort reaches the request

**Files:**
- Create: `e2e/reasoning.spec.ts`

**Interfaces:**
- Consumes: `seedFakeProvider`, `waitForAppReady`, `FAKE_BASE` and `RENDER_TIMEOUT` from `e2e/support.ts`. Uses the UI from Tasks 6 and 8.

- [ ] **Step 1: Write the test**

```ts
import { expect, test, type Page } from '@playwright/test'
import { FAKE_BASE, RENDER_TIMEOUT, seedFakeProvider, waitForAppReady } from './support'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const FENCE = '```'
const REPLY = `Made a cube.\n\n${FENCE}openscad\ncube([20, 20, 10]);\n${FENCE}\n`

/** A fake OpenRouter-style stream: reasoning first, then the reply. Records chat bodies. */
async function reasoningLlm(page: Page, models: unknown[]): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = []
  await page.route(`${FAKE_BASE}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (req.url().endsWith('/models')) {
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ data: models }) })
    }
    const body = req.postDataJSON() as Record<string, unknown>
    bodies.push(body)
    const chunks = [
      { choices: [{ index: 0, delta: { reasoning: 'The wall is 1.6 mm.\n' } }] },
      { choices: [{ index: 0, delta: { reasoning: 'A plain cube will do.' } }] },
      { choices: [{ index: 0, delta: { content: REPLY }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 900, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 320 } } },
    ]
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse })
  })
  return bodies
}

test('reasoning streams into a collapsed box, expands, and survives a reload; no max_tokens is sent', async ({ page }) => {
  const bodies = await reasoningLlm(page, [{ id: 'fake-model' }])
  await seedFakeProvider(page)
  await page.getByLabel('Prompt').fill('A cube')
  await page.getByLabel('Prompt').press('Enter')

  const header = page.getByText(/^Thought for \d+ s · 320 tokens$/)
  await expect(header).toBeVisible({ timeout: RENDER_TIMEOUT })
  await expect(page.getByText('A plain cube will do.')).toBeHidden()
  await header.click()
  await expect(page.locator('.pc-reasoning-body')).toContainText('The wall is 1.6 mm.')
  await expect(page.locator('.pc-reasoning-body')).toContainText('A plain cube will do.')
  await page.locator('.pc-reasoning').screenshot({ path: 'test-results/reasoning-box.png' })
  expect(bodies[0]).not.toHaveProperty('max_tokens')

  await page.reload()
  await waitForAppReady(page)
  await expect(page.getByText(/^Thought for \d+ s · 320 tokens$/)).toBeVisible()
})

test('the effort picker appears for a reasoning model and its choice reaches the request', async ({ page }) => {
  const bodies = await reasoningLlm(page, [{ id: 'fake-model', supported_parameters: ['reasoning'] }])
  await seedFakeProvider(page)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chatscad')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction('providerProfiles', 'readwrite')
    const store = tx.objectStore('providerProfiles')
    const row = await new Promise<Record<string, unknown>>((resolve) => {
      const r = store.get('fake-profile')
      r.onsuccess = () => resolve(r.result as Record<string, unknown>)
    })
    store.put({ ...row, cachedModels: [{ id: 'fake-model', reasoning: { efforts: true, canDisable: true, adaptive: false } }] })
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()))
    db.close()
  })
  await page.reload()
  await waitForAppReady(page)

  await page.getByRole('button', { name: 'Reasoning effort: Default' }).click()
  await page.getByRole('menuitemradio', { name: /High/ }).click()
  await expect(page.getByRole('button', { name: 'Reasoning effort: High' })).toBeVisible()

  await page.getByLabel('Prompt').fill('A cube')
  await page.getByLabel('Prompt').press('Enter')
  await expect(page.getByText(/^Thought for/)).toBeVisible({ timeout: RENDER_TIMEOUT })
  expect(bodies.at(-1)).toMatchObject({ reasoning_effort: 'high' })
})
```

`FAKE_BASE` is `https://fake-llm.test/v1`, which is not OpenRouter, so the body field is `reasoning_effort`. If the app refreshes `cachedModels` from `/models` on load and overwrites the seeded row, the `supported_parameters: ['reasoning']` in the route keeps the picker visible either way.

- [ ] **Step 2: Run it**

Run: `npm run e2e -- e2e/reasoning.spec.ts`
Expected: PASS. If a selector misses, read the Playwright trace and fix the selector or the component (not the assertion's intent). For example, the prompt field's label is `Prompt` per `Composer.tsx`.

- [ ] **Step 3: Run every check and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add e2e/reasoning.spec.ts
git commit -m "test: end-to-end reasoning box, persistence and effort

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```
