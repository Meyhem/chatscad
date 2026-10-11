# Reasoning models: design

Date: 2026-10-11. Trigger: a DeepSeek reasoning model on OpenRouter thought for about two minutes, used the whole 16,000-token `max_tokens`, and ended with "The reply had no code." Visual reference: the mockup shown in the brainstorming session on 2026-10-11 (reasoning box in three states, effort picker, cut-off callout), approved with "Off" added.

## Goals

1. A reasoning model is never cut off by a limit the app picked. How long it thinks is the user's choice of model and effort.
2. The user can choose the reasoning effort when the model supports it: Default, Off, Low, Medium, High.
3. The model's reasoning shows in the chat, collapsed by default, with the newest line shimmering while the model thinks. It is saved with the message.
4. When the provider does cut a reply off, the chat says so instead of "The reply had no code."

## Non-goals

- No reasoning for the visual check (it always runs at the model's default).
- No effort picker for models whose support is unknown (plain OpenAI-compatible servers without model metadata). Their reasoning is still shown when they stream it.
- Reasoning is never sent back to the model, and it does not count towards the history the model sees.
- No `xhigh` or `max` effort levels (YAGNI; High is the top of the picker).

## 1. Provider layer (`src/ai/`)

### Types (`types.ts`)

- `export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'`. "Default" is the absence of a value.
- `ChatRequest` gains `reasoningEffort?: ReasoningEffort`. `maxTokens` stays optional; its meaning changes to "only when the caller needs a cap" (see Limits).
- `ChatEvent` becomes:
  - `{ type: 'text'; delta: string }`
  - `{ type: 'reasoning'; delta: string }` (new)
  - `{ type: 'usage'; usage: Usage; stopReason: StopReason }` with `type StopReason = 'end' | 'length' | 'other'`.
- `Usage` gains `reasoningTokens?: number` (when the provider reports it).
- `ModelInfo` gains:
  - `maxOutputTokens?: number` (Anthropic models API `max_tokens`),
  - `reasoning?: { efforts: boolean; canDisable: boolean }`. Absent means unknown. `efforts` decides whether the picker shows; `canDisable` decides whether it offers "Off".
- `DEFAULT_MAX_TOKENS` is removed. Anthropic gets `ANTHROPIC_FALLBACK_MAX_TOKENS = 64000` for models whose limit is unknown.

### Limits

- **OpenAI-compatible:** no `max_tokens` is sent. The provider's own maximum applies. `relaxRequest` keeps its `max_tokens` handling for callers that still pass one.
- **Anthropic:** `max_tokens` is required. Send `ModelInfo.maxOutputTokens` for the model, else 64,000. The SDK streams, so large values do not hit HTTP timeouts.

### OpenAI-compatible adapter (`openaiCompatible.ts`)

- **Streaming deltas:** read `delta.reasoning` (OpenRouter) and `delta.reasoning_content` (DeepSeek, vLLM, llama.cpp) as `reasoning` events. Read `choices[0].finish_reason`: `"length"` → `'length'`, `"stop"` → `'end'`, anything else → `'other'`.
- **Non-streaming:** read `message.reasoning` / `message.reasoning_content` and `finish_reason` the same way.
- **Usage:** `completion_tokens_details.reasoning_tokens` → `reasoningTokens`.
- **Effort, OpenRouter** (base URL host is `openrouter.ai`): `reasoning: { effort }` for low/medium/high; `reasoning: { enabled: false }` for Off. Nothing for Default. Confirm the exact Off shape against OpenRouter's docs while planning.
- **Effort, other servers:** `reasoning_effort: 'low' | 'medium' | 'high'`; `'none'` for Off. Nothing for Default.
- **Rejection:** `relaxRequest` learns one more fix: a 400 that names `reasoning` or `reasoning_effort` drops the field and retries. The turn gets a note: "This model ignored the reasoning setting." (one per turn).
- **Model list:** OpenRouter's `supported_parameters` containing `reasoning` sets `reasoning: { efforts: true, canDisable: true }`. A list without `supported_parameters` leaves `reasoning` unset.

### Anthropic adapter (`anthropic.ts`)

- **Request:**
  - Default sends no `output_config`, so the model's own effort applies. For `thinking`, see Display below.
  - Low/medium/high send `thinking: { type: 'adaptive', display: 'summarized' }` plus `output_config: { effort }`.
  - Off sends `thinking: { type: 'disabled' }`.
  - Some models reject disabling (Opus 5.5, Sonnet 5.5). If a 400 mentions `thinking`, retry once with `effort: 'low'` and add the note "This model can't turn reasoning off, so it used Low."
- **Display:** whenever thinking is on (Default included), send `display: 'summarized'`. Otherwise current models return empty thinking text and the box would stay blank. Default therefore sends `thinking: { type: 'adaptive', display: 'summarized' }` without `output_config`, but only for models whose capabilities say adaptive thinking is supported. Other models get nothing, as today.
- **Stream:** `content_block_delta` with `delta.type === 'thinking_delta'` yields `reasoning`. `message_delta.delta.stop_reason`: `max_tokens` → `'length'`, `end_turn` → `'end'`, anything else → `'other'`.
- **Model list:** read `max_tokens` → `maxOutputTokens`. From `capabilities`, `effort.supported` → `efforts`, and `thinking.types.disabled?.supported` → `canDisable` (missing means false). The capabilities tree is untyped in the SDK; read it defensively.
- Temperature stays omitted.

### Turn runner (`runTurn.ts`)

- `streamText` returns `{ text, reasoning, usage, stopReason }` and forwards reasoning deltas through a new `onReasoning` callback.
- `GenerateResult` gains `reasoning: string`, `reasoningMs: number | null` (from the first reasoning delta to the first text delta, or to the end) and `stopReason`.
- `TurnEvent` gains `{ type: 'reasoning'; text: string }`.
- `runTurn` takes `reasoningEffort` and passes it on every request of the turn: the first reply, the full-file retry, the scoped retry and auto-fix attempts.
- A full-file retry or auto-fix streams into a fresh assistant message, as today, so each has its own reasoning box.

## 2. State and persistence

- `ChatMessage` gains `reasoning?: string`, `reasoningMs?: number` and `reasoningStartedAt?: number` (memory only, for the live timer).
- `chatStore.appendReasoning(id, delta)` appends a delta and sets `reasoningStartedAt` on the first one.
- `StoredMessage` gains `reasoning: string | null` and `reasoningMs: number | null`. The fields are not indexed, so there is no Dexie version bump. `fromStored` treats missing fields as null.
- `toStored` and `fromStored` map the new fields, and `FileMessage` carries them, so project export and import keep the reasoning. On import, files from before this change have no `reasoning` field; it defaults to null.
- The streaming message is still not written to IndexedDB until it is done, as today, so reasoning deltas do not cause writes.
- `ProviderProfile` gains `reasoningEffort?: Record<string, ReasoningEffort>` (model id → choice). Missing means Default. `providersStore.setReasoningEffort(profileId, model, effort | null)` persists it; null clears it back to Default.
- `sendPrompt` reads the effort for the active profile and model, and passes it to `runTurn`.

## 3. UI

### Reasoning box (`src/chat/ReasoningBox.tsx`)

It renders above the reply text in `MessageView` whenever `reasoning` is non-empty or the message is streaming and reasoning has started.

- **Structure:** a `<details>` element styled with new `pc-reasoning` classes. The `<summary>` is the header; the body is a `<div>`. Collapsed by default. The open state is per message, held in component state, and not persisted.
- **Header (streaming):** brain icon, then "Thinking · 38 s". Seconds tick from `reasoningStartedAt`; from 60 s on it shows "1 min 52 s". There is no live token count: providers report reasoning tokens only at the end.
- **Header (done):** "Thought for 1 min 52 s", plus " · 14,210 tokens" when `reasoningTokens` is known. When `reasoningMs` is unknown (old messages, imports), it shows "Reasoning".
- **Live line:** while streaming and collapsed, the newest non-empty line of reasoning shows below the header. It is a single line in the mono font, trimmed with an ellipsis. It has the `pc-shimmer` animation: a moving highlight from `--ink-muted` to `--ink` and back, made with a background-clip text gradient using tokens only. Under `prefers-reduced-motion: reduce` there is no animation and the line stays `--ink-muted`. The live line is hidden when the box is open or the message is done.
- **Body:** mono 12/18, `--ink-muted`, `white-space: pre-wrap`, `max-height` of about 12 lines with its own scroll. While streaming and open, it stays scrolled to the bottom unless the user has scrolled up (the same rule as the console).
- **Safety:** the reasoning is model output, so it renders as a React text node only. It never goes through `inlineCode`, Markdown or HTML.
- **Accessibility:** the `<summary>` is the focusable toggle. The live line has `aria-hidden="true"`, so screen readers do not hear every delta. The header text carries the state.
- The existing "Thinking…" / "Writing code…" status row stays. Once reasoning has started, "Thinking…" is dropped from that row, because the box says it.

### Effort picker (`src/chat/EffortPicker.tsx`)

- It sits in the composer bar right after `ModelPicker`, using the same `pc-model` button style: brain icon, the current label and a chevron. When the choice is Default, the button shows the icon and "Default".
- It renders only when the active model's `ModelInfo.reasoning?.efforts` is true.
- The menu uses the same popover as `ModelPicker`: `bg-panel-raised`, `shadow-pop`, closes on an outside click and on Escape, with arrow-key navigation. The options, each with a short caption:
  - Default: "The model decides"
  - Off: "No reasoning, fastest". Shown only when `canDisable` is true.
  - Low: "Faster, cheaper"
  - Medium
  - High: "Slower, more tokens"
- The selected option shows a check. Choosing an option calls `setReasoningEffort` and closes the menu.
- `aria-label`: "Reasoning effort: Medium".

### Cut-off callout

- When a reply ends with `stopReason === 'length'` and no code, the message gets `error: { title, body }` in the existing `pc-callout is-error` style:
  - Title: "The reply was cut off before it wrote any code"
  - Body with reasoning: "The model used its whole output allowance ({N} tokens) on reasoning. Try a lower effort or another model."
  - Body without reasoning: "The model reached its output limit ({N} tokens)."
  - {N} is the reported output tokens, formatted with thousands separators.
- The message text then falls back to the empty string, not "The reply had no code."
- When a reply is cut off after it wrote code, the code is used as today (it will usually fail to compile, and auto-fix takes over). No callout is shown.

## 4. Error handling

| Case | Behaviour |
| --- | --- |
| Effort field rejected (OpenAI-compatible 400) | Drop the field, retry once, add a note. |
| Off rejected (Anthropic 400 on `thinking`) | Retry once at Low, add a note. |
| `finish_reason: length` with no code | Cut-off callout (section 3). |
| Reasoning stream only, no text, `stop` | "The reply had no code." stays, but the reasoning box shows what the model thought. |
| User stops mid-reasoning | As today: the reply is marked stopped. The partial reasoning is kept and saved. |

## 5. Testing

TDD throughout: write each failing test first.

- **`openaiCompatible.test.ts`:**
  - SSE fixtures for OpenRouter (`delta.reasoning`, `finish_reason: "length"`, `reasoning_tokens`) and DeepSeek (`delta.reasoning_content`).
  - The request body has no `max_tokens`.
  - Each effort maps to the right body for OpenRouter and for a generic server.
  - A 400 naming `reasoning_effort` triggers the relaxed retry.
  - `supported_parameters` maps to `ModelInfo.reasoning`.
- **`anthropic.test.ts`:**
  - `thinking_delta` events produce reasoning events.
  - `max_tokens` comes from `maxOutputTokens`, with the fallback.
  - Each effort maps to the right request.
  - Off-rejected falls back to Low.
  - `stop_reason: max_tokens` maps to `'length'`.
  - Capabilities map to `ModelInfo`.
- **`runTurn.test.ts`:** reasoning flows through as events; `reasoningMs` is measured; effort reaches every request in a turn, including auto-fix.
- **`chatPersistence` tests:** reasoning round-trips through IndexedDB and project export and import; old rows without the fields load.
- **Component tests:**
  - `ReasoningBox`: collapsed, open and done states; the live line shows the last line; no HTML is rendered from reasoning; the reduced-motion class is present.
  - `EffortPicker`: hidden without support; Off hidden when `canDisable` is false; choosing persists the choice.
  - `MessageView`: the cut-off callout copy.
- **e2e:** one Playwright test with a stubbed OpenAI-compatible endpoint that streams reasoning, then code. Expand the box and check the text. Then reload and check that the reasoning is still there.
- The tokens-only test keeps passing. The shimmer uses token variables only.

## Build order

1. Provider events and limits (no UI): reasoning deltas, stop reasons, no `max_tokens`, Anthropic `max_tokens` from the model list. This alone fixes the reported bug.
2. Cut-off callout.
3. Reasoning in state, persistence and the `ReasoningBox` UI.
4. Effort: model metadata, request mapping, `ProviderProfile` storage and `EffortPicker`.

Each step is one commit: tests, typecheck and e2e pass, then push.
