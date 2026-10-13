# Permissive Model Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both model pickers find a model from any loose, partial, multi-word query ("dee fla 4" lands on `deepseek/deepseek-v4-flash`), matching id and display name, ignoring case and punctuation, and tolerating small typos.

**Architecture:** One matcher in `src/chat/fuzzy.ts`. Query and targets are normalised to lower-case words of letters and digits; each query word is scored against every target (id and name) and the best target wins for that word; every word must match. A word matches, best first, as a contiguous substring (whole word > word start > inside a word), as scattered letters in order, or, failing both, within a small edit distance of a target word. `fuzzyFilter` becomes generic over the item type with a `keys` function, so `ModelPicker` (ids plus names) and `ModelCombobox` (`ModelInfo[]`) share it.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library (jsdom).

**Spec:** `docs/BACKLOG.md`, section "Permissive multi-word model search" (removed from the backlog in the last task; the behaviour bullets are copied below).

Spec behaviour, verbatim:

- Every space-separated word of the query must match somewhere in the model, in any order and in any part of the name: "dee fla 4", "flash dee v4" and "4 flash deep" all find `deepseek/deepseek-v4-flash`.
- Punctuation and case never matter, in the query or the model: "deep-seek v4", "DeepSeek/V4" and "deepseek_v4" match like "deepseek v4".
- Both the model id and the display name the provider reports (`ModelInfo.name`) are searched; a word may match either.
- Small typos still match a long word ("flsh", "deepsek"), ranked below exact and prefix matches.
- Ranking stays as it is for the easy cases: whole words and word starts first, then prefixes, then scattered letters; ties keep the provider's order. The top result is the one Enter picks.

## Global Constraints

- TDD: write the failing test first and watch it fail.
- Tokens only: no hex colours and no Tailwind palette classes in `src/`.
- Copy: sentence case, no exclamation marks or emoji.
- Model names come from providers and are untrusted: React text nodes only.
- No new dependencies.
- After each task: `npm run typecheck`, `npm test`, `npm run e2e` all pass, then commit and push `main` (conventional message, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never push with failing checks.

## Decisions

- **Typo tolerance.** Used only when a word matches neither contiguously nor as scattered letters. Allowed edit distance (optimal string alignment: insert, delete, substitute, swap two neighbours): 0 for words under 5 characters, 1 for 5 to 7, 2 for 8 or more. Compared against each target word and against that word's prefix of the query word's length. Score `-100` per edit, below every contiguous match (≥ ~900). "flsh" and "deepsek" from the spec already match as scattered letters; real typos such as "flahs" or "deepseck" need this.
- **Letters and digits in any script** count as word characters (`\p{L}\p{N}`), and accents are folded (`é` → `e`), so non-Latin model names stay searchable and a query of only punctuation matches everything.
- **Enter in the chat picker** picks the top shown result when there is one, else the typed text for the active profile (today it always picks the typed text). The "Use “…” with …" button still uses the typed text.
- **The chat picker keeps showing ids**; names are searched but not displayed (the button text is unchanged, so existing tests and e2e locators hold).

## Review Focus

1. **Short query words over-matching through typos** ("gpt", "4", "mini"): no typo tolerance below 5 characters, so a 3-letter word never matches a different 3-letter word. Test in Task 1.
2. **A query of only punctuation or spaces** ("-", " / "): matches everything in provider order, like an empty query, instead of nothing. Test in Task 1.
3. **Models with no name or a non-Latin name** (`name` undefined, "通义千问"): no crash, and the non-Latin name is still searchable. Test in Task 1.
4. **Enter with a typed id that has no match** ("mistral/devstral" on a list without it): still selects the typed id, not some loose fuzzy hit. Test in Task 2.
5. **Combobox ordering changes from provider order to ranked order**: the highlighted option and the "N of M models" count follow the ranked list. Test in Task 3.

---

### Task 1: Normalising, multi-target matcher with typo tolerance

**Files:**
- Modify: `src/chat/fuzzy.ts`
- Test: `src/chat/fuzzy.test.ts`

**Interfaces:**
- Produces:
  - `normalise(text: string): string`: lower-case, accents folded, every run of non letter/digit characters becomes one space, trimmed.
  - `editDistance(a: string, b: string): number`
  - `fuzzyScore(query: string, texts: string | readonly string[]): number | null`
  - `fuzzyFilter<T = string>(query: string, items: readonly T[], keys?: (item: T) => readonly string[]): T[]`. `keys` defaults to `(item) => [String(item)]`, so `fuzzyFilter(q, ids)` keeps working.

- [ ] **Step 1: Write the failing tests**

Append to `src/chat/fuzzy.test.ts`, change the import to `import { editDistance, fuzzyFilter, fuzzyScore, normalise } from './fuzzy'`, and replace the `rejects characters out of order or missing` test's second line: `'qwenz'` is now a legitimate one-letter typo of the word `qwen`, so use a word that is three edits away.

```ts
it('rejects characters out of order or missing', () => {
  expect(fuzzyScore('5gpt', 'openai/gpt-5-mini')).toBeNull()
  expect(fuzzyScore('qwexyz', 'qwen/qwen3-coder')).toBeNull()
})
```

New tests:

```ts
const DEEPSEEK = ['deepseek/deepseek-v4-flash', 'DeepSeek: DeepSeek V4 Flash']

it('normalises case, punctuation and accents to plain words', () => {
  expect(normalise('DeepSeek/V4-flash_2.5')).toBe('deepseek v4 flash 2 5')
  expect(normalise('  Café / Crème  ')).toBe('cafe creme')
  expect(normalise('通义千问-Max')).toBe('通义千问 max')
  expect(normalise(' - / ')).toBe('')
})

it('finds a model from loose words in any order', () => {
  for (const q of ['dee fla 4', 'flash dee v4', '4 flash deep']) expect(fuzzyScore(q, DEEPSEEK)).not.toBeNull()
})

it('ignores punctuation and case in the query and the model', () => {
  for (const q of ['deep-seek v4', 'DeepSeek/V4', 'deepseek_v4']) expect(fuzzyScore(q, 'deepseek/deepseek-v4-flash')).not.toBeNull()
})

it('lets each word match either the id or the name', () => {
  expect(fuzzyScore('falcon m1', ['acme/m1', 'Acme Falcon'])).not.toBeNull()
  expect(fuzzyScore('falcon', ['acme/m1'])).toBeNull()
})

it('tolerates small typos in long words, ranked below exact and prefix matches', () => {
  expect(fuzzyScore('flsh', DEEPSEEK)).not.toBeNull()
  expect(fuzzyScore('deepsek', DEEPSEEK)).not.toBeNull()
  expect(fuzzyScore('flahs', DEEPSEEK)).not.toBeNull()
  expect(fuzzyScore('deepseck', DEEPSEEK)).not.toBeNull()
  const typo = fuzzyScore('flahs', DEEPSEEK)!
  expect(fuzzyScore('flash', DEEPSEEK)!).toBeGreaterThan(typo)
  expect(fuzzyScore('fla', DEEPSEEK)!).toBeGreaterThan(typo)
})

it('allows no typos in short words', () => {
  expect(fuzzyScore('gtp', 'openai/gpt-5-mini')).toBeNull()
  expect(fuzzyScore('mimi', 'openai/gpt-5-mini')).toBeNull()
})

it('ranks whole words above word starts above scattered letters', () => {
  const ranked = fuzzyFilter('flash', ['x/f-l-a-s-h', 'x/flashy', 'x/flash'])
  expect(ranked).toEqual(['x/flash', 'x/flashy', 'x/f-l-a-s-h'])
})

it('matches everything in the original order for a query of only punctuation', () => {
  expect(fuzzyFilter(' - / ', ['b', 'a'])).toEqual(['b', 'a'])
})

it('filters any item type through its keys, and survives missing or non-Latin names', () => {
  const models = [{ id: 'qwen/qwen3-max', name: '通义千问 Max' }, { id: 'deepseek/deepseek-v4-flash' }]
  const keys = (m: { id: string; name?: string }) => [m.id, m.name ?? '']
  expect(fuzzyFilter('通义', models, keys)).toEqual([models[0]])
  expect(fuzzyFilter('dee fla', models, keys)).toEqual([models[1]])
})

it('counts edit distance with neighbour swaps as one edit', () => {
  expect(editDistance('flahs', 'flash')).toBe(1)
  expect(editDistance('deepseck', 'deepseek')).toBe(1)
  expect(editDistance('qwexyz', 'qwen3')).toBe(3)
  expect(editDistance('', 'abc')).toBe(3)
})
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/chat/fuzzy.test.ts`
Expected: FAIL. `normalise` and `editDistance` are not exported, and the punctuation, name and typo cases return null.

- [ ] **Step 3: Implement the matcher**

Replace `src/chat/fuzzy.ts` with:

```ts
/** Lower-case words of letters and digits in any script; accents, case and punctuation never matter. */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Optimal string alignment distance: insertions, deletions, substitutions and swaps of two neighbours. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

const isWordStart = (text: string, i: number) => i === 0 || text[i - 1] === ' '
const isWordEnd = (text: string, i: number) => i === text.length || text[i] === ' '

/** Edits a word of this length may contain and still match. */
const allowedTypos = (length: number) => (length >= 8 ? 2 : length >= 5 ? 1 : 0)
const TYPO_PENALTY = -100

// The best contiguous occurrence: whole words, then word starts, then earlier positions.
function contiguousScore(word: string, text: string): number | null {
  let best: number | null = null
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    const start = isWordStart(text, at)
    const s = 1000 + (start ? 100 : 0) + (start && isWordEnd(text, at + word.length) ? 50 : 0) - at
    if (best === null || s > best) best = s
  }
  return best
}

// The word's characters in order with gaps, or null.
function scatteredScore(word: string, text: string): number | null {
  let score = 0
  let prev = -1
  for (const ch of word) {
    const i = text.indexOf(ch, prev + 1)
    if (i === -1) return null
    if (isWordStart(text, i)) score += 10
    if (i === prev + 1) score += 5
    else if (prev !== -1) score -= i - prev - 1
    prev = i
  }
  return score
}

// A word within a few edits of a target word, or of that word's start.
function typoScore(word: string, text: string): number | null {
  const allowed = allowedTypos(word.length)
  if (allowed === 0) return null
  let best = Infinity
  for (const token of text.split(' ')) {
    best = Math.min(best, editDistance(word, token), editDistance(word, token.slice(0, word.length)))
  }
  return best <= allowed ? TYPO_PENALTY * best : null
}

// Score one normalised query word against one normalised text. A contiguous match always outranks a scattered one, which outranks a typo.
function wordScore(word: string, text: string): number | null {
  return contiguousScore(word, text) ?? scatteredScore(word, text) ?? typoScore(word, text)
}

/** Higher is better; null means no match. Every word of the query must match one of `texts`; each word takes its best text. */
export function fuzzyScore(query: string, texts: string | readonly string[]): number | null {
  const words = normalise(query).split(' ').filter(Boolean)
  const targets = (typeof texts === 'string' ? [texts] : texts).map(normalise).filter(Boolean)
  let total = 0
  for (const w of words) {
    let best: number | null = null
    for (const t of targets) {
      const s = wordScore(w, t)
      if (s !== null && (best === null || s > best)) best = s
    }
    if (best === null) return null
    total += best
  }
  return total
}

/** The items that match the query, best first; ties keep their original order. `keys` gives the texts to search per item. */
export function fuzzyFilter<T = string>(query: string, items: readonly T[], keys: (item: T) => readonly string[] = (item) => [String(item)]): T[] {
  if (normalise(query) === '') return [...items]
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, keys(item)) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item)
}
```

Note: `wordScore` uses `??`, which only falls through on `null`. A score of `0` from a scattered match is a match, so this is correct, but do not "simplify" it to `||`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/chat/fuzzy.test.ts src/chat/ModelPicker.test.tsx`
Expected: PASS, including the existing ranking test (`sonnet-mini` first, then `claude-sonnet-4-5`, then `some-other-nano-net`) and the existing `ModelPicker` tests that call `fuzzyFilter(typed, modelIds(p))`.

- [ ] **Step 5: Full checks and commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all pass.

```bash
git add src/chat/fuzzy.ts src/chat/fuzzy.test.ts
git commit -m "feat: model search ignores punctuation, searches several texts and tolerates typos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: Chat model picker searches names, and Enter picks the top result

**Files:**
- Modify: `src/chat/ModelPicker.tsx`
- Test: `src/chat/ModelPicker.test.tsx`

**Interfaces:**
- Consumes: `fuzzyFilter<T>(query, items, keys)` from Task 1.
- Produces: no new exports. `modelIds(profile)` is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `src/chat/ModelPicker.test.tsx`:

```ts
const deepseek = newProfile({
  name: 'DeepSeek router',
  adapter: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-5-mini',
  cachedModels: [
    { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini' },
    { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek: DeepSeek V4 Flash' },
    { id: 'acme/m1', name: 'Acme Falcon' },
  ],
})

it('finds a model by its display name', async () => {
  seed([deepseek])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  await userEvent.type(screen.getByLabelText('Search models'), 'falcon')
  expect(screen.getByRole('button', { name: 'acme/m1' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'openai/gpt-5-mini' })).toBeNull()
})

it('picks the top match with Enter for a loose multi-word query', async () => {
  seed([deepseek])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  await userEvent.type(screen.getByLabelText('Search models'), 'dee fla 4')
  await userEvent.keyboard('{Enter}')
  expect(selectActiveModel(useProvidersStore.getState())).toBe('deepseek/deepseek-v4-flash')
  expect(screen.queryByLabelText('Search models')).toBeNull()
})
```

The existing test `accepts a model name typed by hand for the active profile` (types `mistral/devstral`, presses Enter, expects `mistral/devstral`) stays as it is: it pins Review Focus item 4.

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/chat/ModelPicker.test.tsx`
Expected: FAIL. "falcon" finds nothing because only ids are searched, and Enter selects the literal text "dee fla 4".

- [ ] **Step 3: Implement**

In `src/chat/ModelPicker.tsx`, compute the filtered groups once, before the JSX, and use them for both rendering and Enter:

```tsx
  const groups = profiles
    .map((p) => {
      const names = new Map(p.cachedModels.map((m) => [m.id, m.name ?? '']))
      return { profile: p, ids: fuzzyFilter(typed, modelIds(p), (id) => [id, names.get(id) ?? '']).slice(0, MAX_PER_PROFILE) }
    })
    .filter((g) => g.ids.length > 0)
  const top = typed !== '' ? groups[0] : undefined
```

Place this after `const typed = query.trim()` (it must come after the `profiles.length === 0` early return, as `typed` does).

Change the input's `onKeyDown`:

```tsx
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || typed === '') return
                if (top) {
                  e.preventDefault()
                  pick(top.profile.id, top.ids[0])
                } else if (active) {
                  e.preventDefault()
                  pick(active.id, typed)
                }
              }}
```

Replace the `profiles.map(...)` block in the menu with:

```tsx
          {groups.map(({ profile: p, ids }) => (
            <div key={p.id} role="group" aria-label={p.name} className="flex flex-col">
              <span className="pc-label px-2 py-1">{p.name}</span>
              {ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="pc-btn is-ghost is-sm justify-start font-mono"
                  aria-pressed={p.id === active?.id && id === model}
                  onClick={() => pick(p.id, id)}
                >
                  {id}
                </button>
              ))}
            </div>
          ))}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/chat/ModelPicker.test.tsx`
Expected: PASS, all tests including the existing ones.

- [ ] **Step 5: Full checks and commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all pass.

```bash
git add src/chat/ModelPicker.tsx src/chat/ModelPicker.test.tsx
git commit -m "feat: chat model picker searches names and Enter picks the top match

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Settings model combobox uses the same matcher

**Files:**
- Modify: `src/settings/ModelCombobox.tsx`, `docs/BACKLOG.md`
- Test: `src/settings/ModelCombobox.test.tsx`

**Interfaces:**
- Consumes: `fuzzyFilter<T>(query, items, keys)` from Task 1 (import from `'../chat/fuzzy'`).

- [ ] **Step 1: Write the failing tests**

Add to `src/settings/ModelCombobox.test.tsx`:

```ts
const ROUTER: ModelInfo[] = [
  { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini' },
  { id: 'example/flash-lite', name: 'Example Flash Lite' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek: DeepSeek V4 Flash' },
]

it('finds a model from loose words, punctuation and typos, best match first', async () => {
  render(<Harness models={ROUTER} />)
  await userEvent.type(box(), 'dee fla 4')
  expect(options()[0]).toHaveTextContent('deepseek/deepseek-v4-flash')
  expect(options()).toHaveLength(2) // the match and "Use … as typed"

  await userEvent.clear(box())
  await userEvent.type(box(), 'DeepSeek/V4')
  expect(options()[0]).toHaveTextContent('deepseek/deepseek-v4-flash')

  await userEvent.clear(box())
  await userEvent.type(box(), 'flahs')
  expect(options().map((o) => o.textContent)).toEqual([
    expect.stringContaining('example/flash-lite'),
    expect.stringContaining('deepseek/deepseek-v4-flash'),
    'Use “flahs” as typed',
  ])
})

it('highlights and counts the ranked list, not the provider order', async () => {
  const onPick = vi.fn()
  render(<Harness models={ROUTER} onPick={onPick} />)
  await userEvent.type(box(), 'flash')
  // "Example Flash Lite" has "flash" as a whole word earlier in its name than the DeepSeek entry.
  expect(screen.getByText('2 of 3 models · prices per 1M input / output tokens')).toBeInTheDocument()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(onPick).toHaveBeenCalledWith(ROUTER[1])
})
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/settings/ModelCombobox.test.tsx`
Expected: FAIL. The current filter is a plain `includes`, so "dee fla 4", "DeepSeek/V4" and "flahs" find nothing.

- [ ] **Step 3: Implement**

In `src/settings/ModelCombobox.tsx`, import the matcher and replace the two filter lines:

```ts
import { fuzzyFilter } from '../chat/fuzzy'
```

```ts
  const matches = fuzzyFilter(query, models, (m) => [m.id, m.name ?? ''])
```

Delete the now-unused `const q = query.trim().toLowerCase()`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/settings/ModelCombobox.test.tsx`
Expected: PASS. The existing `filters by id and name…` test still sees Claude Sonnet first: both entries match "sonnet" as a whole word, and the Claude name puts it at position 7 against 8 for `example sonnet coder 32b`, so the ranking agrees with the provider order.

- [ ] **Step 5: Remove the backlog entry**

Delete the whole `## Permissive multi-word model search` section from `docs/BACKLOG.md`.

- [ ] **Step 6: Full checks and commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all pass.

```bash
git add src/settings/ModelCombobox.tsx src/settings/ModelCombobox.test.tsx docs/BACKLOG.md
git commit -m "feat: settings model field uses the permissive model search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
