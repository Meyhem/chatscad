# ChatSCAD M3 — Parametric and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every model becomes a project with a persistent version tree (AI, manual, slider, restore and gallery versions with thumbnails, diff, restore, branch, undo and redo), tuned through Customizer controls that re-render with `-D` overrides, started from eight bundled parametric examples, with optional BOSL2 and MCAD libraries, the remaining settings sections and a passphrase lock for API keys.

**Architecture:** A comment- and string-aware OpenSCAD lexer (`src/scad/`) feeds the Customizer parser, which turns top-level annotated assignments into controls; the app store gains `params`, the render loop sends only the values that differ from the source defaults as `-D` overrides, and `runOpenSCAD` writes enabled library bundles into the worker FS under `/libraries/`. Dexie schema v2 adds projects, versions, messages, presets and blobs; a `projectStore` (Zustand) owns the open project and its head, and a `recorder` watches the app store and turns AI, slider, restore and coalesced manual changes into versions with 96 px thumbnails captured from the viewer canvas. The History, Gallery and new Settings sections are plain React views switched by the store's `view`; the History preview renders through its own `RenderController` instance and worker so it never disturbs the workbench render.

**Tech Stack:** as M1 and M2 (Vite, React 19, TypeScript strict, Tailwind v4, Zustand, Comlink, CodeMirror 6, react-three-fiber, OpenSCAD WASM, Dexie 4, `fake-indexeddb` for tests, Vitest, Playwright), plus `diff` 9 (`diffLines`, bundled types). BOSL2 and MCAD are fetched by a pinned-URL + SHA-256 script, like the OpenSCAD WASM. WebCrypto (PBKDF2 + AES-GCM) for the lock. No other new dependency.

**Spec:** [`docs/SPEC.md`](../../SPEC.md) ("Editing modes › Parametric models", "Projects and version history", "Variants, gallery…" › Example gallery, "Security" › Key storage) and [`docs/superpowers/specs/2026-10-11-m2-m5-design.md`](../specs/2026-10-11-m2-m5-design.md) (decisions D3, D6, D7, D8, D13, D14; "M3 — Parametric and history"; **Shared contracts**).

**Prerequisite:** M2 has been executed exactly as the design doc's **Shared contracts** describe: `src/ai/*` (`types.ts`, `createProvider.ts`, `prompt.ts` with `PromptContext`, `runTurn.ts`), `src/db/db.ts` (Dexie v1 with `providerProfiles`, `usage`, `settings`, `DEFAULT_SETTINGS`, `ChatScadDb`, `db`) with repositories `src/db/profiles.ts`, `src/db/usage.ts`, `src/db/settings.ts`, `src/chat/chatStore.ts` (`ChatMessage`), `src/ui/format.ts` (`formatCost`, `formatTokens`), `src/render/awaitRender.ts`, and the store additions `codeSource`, `lastRender`, `setCode(code, source)`, `view`, `setView`. This plan references M2 code only through those names. Where a task changes an M2 file, it shows the full new code of the pieces it changes and says what to keep; it never cites M2 line numbers. Two M2 details the contracts leave open are pinned as assumptions in "Contract issues" at the end (the chat store's hook name, and the names of three repository functions); each task that touches them gives the fallback code to add if M2 named them differently.

**Design sources:** [`design/screens/`](../../../design/screens/): `Main.dc.html` (Customizer dock under the viewer, project button, "v3 · edited by slider" caption, History button), `History.dc.html`, `Gallery.dc.html`, `Providers.dc.html` (settings nav sections only), `CompileError.dc.html` (Problems tab, "from v3" next to the dims, "Showing v3, the last version that compiled", console head "OpenSCAD 2025.03 · manifold"). Deferred from these screens: the Share button and the "Timelapse GIF" button in the History footer (M4), the "Ask Claude about the selection" button (M5), the phone parameter sheet (M4). See "Deferred from M3".

## Global Constraints

From the spec and the design doc:

- "Every change (AI, manual, slider) is a version you can diff, restore or branch from." History is a tree: "editing an old version creates a branch instead of discarding newer work."
- "Manual edits are coalesced: a version is created on render success, on blur, or after 30 s idle, not on every keystroke."
- "Each version stores a small PNG thumbnail captured from the viewer": 96 px square PNG `Blob` in `blobs` with `kind: 'thumbnail'`.
- "Timeline panel: thumbnails, source icon, message; tap to preview without switching head; restore, branch, or diff (side-by-side code diff)." "Undo/redo moves along the head's ancestry."
- Customizer (D7): hand-written lexer in `src/scad/`, no tree-sitter. Only top-level assignments before the first `module` or `function` definition; `/* [Group] */` tabs; `/* [Hidden] */` hides; controls per the spec table (slider + number, number with step, dropdown, toggle, text, vector).
- "Changes re-render via `-D` overrides without touching source." Only values that differ from the source default are sent.
- "'Bake' writes values into the code as a new version; named presets per project; 'Reset to defaults'. Un-annotated top-level numbers still get a number input, with an 'Ask AI to annotate' button."
- Gallery: "box with lid, enclosure, bracket, knob, gear, hinge, cable clip, phone stand". "'Start from this' copies it into a new project as version 1." Stored as `src/gallery/examples/*.scad` + `index.ts` (design doc); thumbnails are the screen's iso line glyphs, not renders. Units are millimetres.
- Libraries (D8): BOSL2 and MCAD are optional per project (`projects.enabledLibraries`), pinned by URL + SHA-256, served from `public/libraries/`, written into the worker FS only when enabled; the system prompt mentions a library only when it is enabled.
- Dexie v2 keeps M2 data: `providerProfiles`, `usage`, `settings` survive the upgrade; new settings fields are filled from `DEFAULT_SETTINGS`.
- Security: "Optional lock mode: encrypt keys with a passphrase (PBKDF2 to an AES-GCM key via WebCrypto), held in memory until the tab closes." PBKDF2 SHA-256, 310,000 iterations, random 16-byte salt stored in settings; `apiKey` holds base64 ciphertext with `keyEncrypted: true`; the unlocked key lives in module-level variables only. Keys are never in project exports.
- "Imports. Project JSON is schema-validated before writing to the database."
- "Request `navigator.storage.persist()` so the browser does not evict data; show usage in settings."
- All IDs `crypto.randomUUID()`; all timestamps `Date.now()` ms (D13). Money via `formatCost`, tokens via `formatTokens` (D14).
- New dependency allowed in M3: `diff` only.

From CLAUDE.md:

- **TDD.** Write the failing test first and watch it fail. Tests that read the filesystem start with `// @vitest-environment node`.
- **Tokens only.** No hex colours and no Tailwind palette classes in `src/` (`src/styles/noHardcodedColors.test.ts` enforces it). Use CSS variables, token utilities (`bg-panel`, `text-ink`, `border-line`, `bg-ok-soft`, `text-error` …) and `pc-*` classes. Never edit `src/styles/tokens.css` by hand.
- **Copy follows the design system voice.** Sentence case, units on every number ("138 × 44 × 32 mm", "Rendered 412 ms", "12.4 MB"), the `×` sign, errors that say what failed and where, no exclamation marks or emoji; never "head", "blob", "AST" in the UI.
- **CSP stays strict.** `script-src 'self' 'wasm-unsafe-eval'`; library bundles are fetched from `'self'`; no CDN.
- **Model output is untrusted.** Code, version messages, chat text and imported project text render as React text nodes only.
- **OpenSCAD WASM and the libraries are pinned by URL and SHA-256.** Bump on purpose, never "latest" into the build.
- **Base path.** Asset URLs use `import.meta.env.BASE_URL` (`${BASE_URL}libraries/BOSL2.json`, `${BASE_URL}openscad/VERSION`).
- Git: one logical change per commit, conventional message, `npm run typecheck && npm test && npm run e2e` green before every push; never force-push.

From the design system (`design/components.css`, screens):

- Parameter rows are `pc-param` with the range under the name (`<small>[17 : 0.5 : 22]</small>`), `pc-range`, a `pc-input is-mono` value field with `pc-unit`, and `is-changed` (accent dot) when the value differs from the default.
- Version rows are `pc-version` with `pc-thumb`, `pc-version-text` (`.t` icon + label, `.m` message), age caption; `aria-current="true"` marks the previewed row, `is-branch` indents, `is-failed` dims the thumbnail.
- Gallery cards are `pc-variant` with `pc-variant-view` glyph, name, "N params" in mono, tags, "Start from this".
- `accent` marks what the person is working on (one primary button per region: Restore vN in the preview pane). Status always carries an icon and a word. A failure is never a modal.

## Review Focus

1. **Strings and comments that look like code or annotations** (`label = "w = 5; // [1:10]";`, `/* depth = 3; */`, `url = "http://x/y";`, `include <BOSL2/std.scad>` before the parameters). Expected: no phantom parameters; `label` is a text control whose default is the literal string; `url` keeps its `//`; parameters after the include are found. *Pinned in Task 1 (lexer string/comment/include tests) and Task 2 (Customizer string tests).*
2. **Switching versions with unsaved edits** (type in the editor, then at once click Restore v1, press Ctrl+Z, open another project or start a gallery example). Expected: the pending edit is first saved as its own version, nothing typed is lost, the restore makes a new version, and undo returns to the version before the edit. *Pinned in Task 9 (every head change awaits `beforeLeaveHead`) and Task 11 (flush and the dirty-then-AI ordering tests).*
3. **Export after moving a slider.** Expected: Export STL is disabled ("Wait for the render to finish") from the moment a parameter changes until the render with exactly those values succeeds, so the downloaded STL always matches code plus parameters. *Pinned in Task 3 (`selectCanExport` with params) and Task 23 (App test).*
4. **A hostile or corrupt project file** (`"__proto__"` as a parameter name, a parent that points at a later or missing version, a 2 MB code string, a missing head, `<img src=x onerror=alert(1)>` in a message). Expected: rejected with an error that names the field ("versions[2].parentId points at a version that is not earlier in the file"), nothing written; or, for the HTML, imported and shown as literal text. *Pinned in Task 16 (validator tests) and Task 17 (History renders messages as text).*
5. **Upgrading an M2 database and locking keys.** Expected: profiles, usage and settings from Dexie v1 survive the v2 upgrade; with lock mode on, a provider call while locked fails with "Your API keys are locked. Unlock them in Settings › Security." and never sends ciphertext as a key; a wrong passphrase is reported in plain words and changes nothing. *Pinned in Task 6 (upgrade test) and Task 21 (lock tests).*

## Design fidelity checks

| Rule (source) | Where it is enforced |
| --- | --- |
| Parameter row: name with `[min : step : max]` hint, `pc-range` + mono value with `mm` unit, accent dot when changed (Main, `pc-param`) | Task 13: `ParamRow` tests |
| Dock: group tabs, "Preset: default" select, Reset (ghost) and Bake into code (Main) | Task 14: `CustomizerDock` tests |
| Code pane caption "v3 · edited by slider"; "Problems 1" tab with the count in `error` (Main, CompileError) | Task 15: `CodePane` tests |
| Console head names the engine: "OpenSCAD 2026.10.08 · manifold" (CompileError) | Task 15: `parseEngineVersion` and `CodePane` tests |
| Stale model: "from v3" beside the dims and "Showing v3, the last version that compiled" (CompileError) | Task 10 (`staleText`) and Task 18 (`RenderedFromCaption`) tests |
| Version list: "v6 · current", source icons, `is-branch` under its parent, `is-failed` "Failed · …", "+ N variants not picked", "7 versions · 1 branch" (History) | Task 17: `buildTimeline` and `HistoryView` tests |
| Compare: two version selects, `+N` in `ok`, `−N` in `error`, "⋯ 7 unchanged lines" (History) | Task 8 (`sideBySide`) and Task 17 tests |
| Preview: "Preview · v5", "not the current version", primary "Restore v5", "Branch from here", "Restoring makes a new version. Nothing is deleted." (History) | Task 17: `HistoryView` tests |
| Gallery: "Start from a working model", search, tabs "All 8 / Storage / Mounting / Mechanical / Desk", cards with glyph, "6 params", tags (Gallery) | Task 19 (param counts match the screen) and Task 20 tests |
| Settings nav order: AI providers, Usage and cost, Rendering, Libraries, Appearance, Storage and backup, Security (Providers) | Task 22: `SETTINGS_SECTIONS` test |
| No hard-coded colours in any new file | Existing `src/styles/noHardcodedColors.test.ts` covers every new `.ts`/`.tsx` under `src/` |

## File Structure

```
package.json                         + diff; fetch:libraries script; predev/prebuild/pretest also fetch libraries
.gitignore                           + public/libraries/
.github/workflows/pages.yml          cache and fetch the pinned libraries before the tests
scripts/fetch-libraries.ts           tsx: download pinned BOSL2/MCAD zips, verify SHA-256, write public/libraries/<name>.json
scripts/fetch-libraries.test.ts
public/libraries/                    (git-ignored) BOSL2.json, MCAD.json
src/scad/lexer.ts                    lex(): comment-, string- and include-path-aware OpenSCAD tokens
src/scad/customizer.ts               parseCustomizer(), bakeParams(), paramOverrides(), effectiveValues()
src/render/params.ts                 Params, paramValueEqual(), paramsEqual()
src/render/libraries.ts              LIBRARY_NAMES, LIBRARY_INFO, LibraryBundle, libraryUrl(), writeLibraries()
src/render/types.ts                  (modify) RenderRequest.libraries
src/render/runOpenSCAD.ts            (modify) load and write enabled libraries, OPENSCADPATH
src/render/render.worker.ts          (modify) cached library fetch from BASE_URL
src/render/openscad.wasm.test.ts     real OpenSCAD WASM in Node: -D overrides, BOSL2, MCAD
src/render/engineVersion.ts          parseEngineVersion(), loadEngineVersion(), engineLabel()
src/render/useRenderLoop.ts          (modify) buildRenderRequest(); sends { code, params (overrides), libraries }
src/state/store.ts                   (modify) params, renderedParams, setParams, libraries, setLibraries; view adds history/gallery
src/test/openscadNode.ts             real-WASM factory and library loader for Node tests
src/test/resetDb.ts                  wipe and reopen the Dexie singleton between tests
src/test/fixtures.ts                 makeVersion(), makeProject()
src/db/db.ts                         (modify) schema v2, M3 tables and settings fields, upgrade
src/db/settings.ts                   (M2; add if missing) getSettings, updateSettings
src/db/profiles.ts                   (M2; modify) saveProfile seals the key when lock mode is on
src/db/projects.ts                   putProject, getProject, listRecentProjects, listAllProjects, deleteProjectCascade
src/db/messages.ts                   putMessage, listMessages, messagesForVersion
src/db/presets.ts                    listPresets, putPreset, deletePreset
src/db/blobs.ts                      putBlob, getBlob
src/db/usageLinks.ts                 creating-hook that tags usage with the project; link usage to versions
src/db/usageTotals.ts                per-profile totals since a time; startOfDay, startOfMonth
src/settings/settingsStore.ts        useSettingsStore (Zustand mirror of the settings row)
src/settings/theme.ts                applyTheme()
src/settings/format.ts               formatBytes()
src/settings/sections.tsx            SETTINGS_SECTIONS registry
src/settings/sections/*.tsx          Usage, Rendering, Libraries, Appearance, Storage, Security sections
src/security/lock.ts                 PBKDF2 → AES-GCM; enable, unlock, lock, disable, forget; sealProfile, resolveApiKey
src/ai/createProvider.ts             (M2; modify) resolves the API key through the lock
src/ai/errors.ts                     (M2; modify) explains locked keys
src/ai/prompt.ts                     (M2; verify) system prompt appends the library section
src/ai/libraryPrompt.ts              librarySection()
src/chat/promptRequest.ts            usePromptRequest, fillComposer(), ComposerBridge, ANNOTATE_PROMPT
src/chat/ProjectCostCaption.tsx      "$0.026 this project"
src/history/versions.ts              createVersion, listVersions, ancestry, nextLabel, getVersion, updateVersion
src/history/diff.ts                  sideBySide(), countLineChanges()
src/history/messages.ts              version messages: manual, slider, bake, truncate
src/history/matchesHead.ts           does the editor (code + params) equal the head version?
src/history/projectStore.ts          useProjectStore: project, versions, head, open/new/restore/branch/undo/redo/commit
src/history/recorder.ts              startRecorder(), flushRecorder(): store changes → versions, coalesced manual edits
src/history/chatPersistence.ts       ChatMessage ↔ StoredMessage, turns linked to versions, chat loaded per project
src/history/projectCost.ts           projectCost(messages)
src/history/projectFile.ts           export/import project JSON and backups, schema validation
src/history/sources.ts               SOURCE_CAPTION, SOURCE_NAME, SOURCE_ICON, versionCaption()
src/history/timeline.ts              buildTimeline(), formatAge(), timelineCaption()
src/history/DiffView.tsx             side-by-side diff
src/history/VersionThumb.tsx         stored thumbnail or the iso glyph
src/history/usePreviewRender.ts      second RenderController for the preview pane
src/history/HistoryView.tsx          Versions | Compare | Preview
src/history/renderedVersion.ts       renderedVersionLabel(), useRenderedVersionLabel()
src/customizer/units.ts              unitFor()
src/customizer/ParamRow.tsx          one pc-param row per control kind
src/customizer/CustomizerDock.tsx    tabs, rows, presets, Reset, Bake into code, Ask AI to annotate
src/viewer/thumbnail.ts              setThumbnailSource(), captureThumbnail(), squareCrop()
src/viewer/staleText.ts              "Showing v3, the last version that compiled"
src/viewer/Viewer.tsx                (modify) thumbnail source, stale label
src/editor/CodeEditor.tsx            (modify) onBlur; value-prop sync no longer echoes through onChange
src/panels/ConsolePanel.tsx          (modify) engineLabel prop
src/ui/icons.ts                      (modify) the Lucide icons M3 uses
src/ui/Glyph.tsx                     iso line glyph (History fallback thumbnails, Gallery cards)
src/workbench/CodePane.tsx           main.scad | Problems tabs, version caption, editor, console
src/workbench/ProblemsPanel.tsx      problemItems(), ProblemsPanel
src/workbench/ProjectMenu.tsx        project button + menu: new, rename, examples, export, import, recent, delete
src/workbench/HistoryControls.tsx    Undo, Redo, History toggle
src/workbench/useUndoShortcuts.ts    Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y outside the editor
src/workbench/RenderedFromCaption.tsx "from v3"
src/gallery/examples/*.scad          8 parametric examples
src/gallery/index.ts                 EXAMPLES metadata (name, tags, category, glyph, code)
src/gallery/GalleryView.tsx          Examples page
src/app/startApp.ts                  bootstrap: settings, theme, usage hook, recorder, chat persistence, last project
src/main.tsx                         (modify) void startApp()
src/App.tsx                          (modify) header controls, dock, CodePane, History and Examples views
e2e/history.spec.ts                  gallery → slider → History restore → reload; BOSL2 through the worker
e2e/smoke.spec.ts                    (modify) the stale label names the version
```

Tests sit next to the code they cover (`*.test.ts(x)`); each task lists its own.

---
### Task 1: OpenSCAD lexer

**Files:**
- Create: `src/scad/lexer.ts`
- Test: `src/scad/lexer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (contract, `src/scad/lexer.ts`):
  - `type TokenKind = 'ident' | 'number' | 'string' | 'punct' | 'comment' | 'whitespace' | 'eof'`
  - `interface Token { kind: TokenKind; text: string; start: number; end: number; line: number }` (`line` is 1-based, the line the token starts on)
  - `lex(code: string): Token[]`: lossless (joining every `text` gives `code` back), always ends with one `eof` token. Line comments exclude their newline. The path after `include`/`use` (`<BOSL2/std.scad>`) is one `string` token. Two-character operators `== != <= >= && ||` are one `punct` token; every other punctuation character is its own token. A leading `-` is punctuation, never part of a number. Unterminated strings and block comments run to the end of the input.

- [ ] **Step 1: Write the failing test**

`src/scad/lexer.test.ts`:

```ts
import { lex, type Token } from './lexer'

const significant = (code: string) =>
  lex(code)
    .filter((t) => t.kind !== 'whitespace')
    .map((t) => [t.kind, t.text])

it('splits identifiers, numbers, strings and punctuation, with a leading minus as punctuation', () => {
  expect(significant('w = -40.5e1; $fn=8; s = "x";')).toEqual([
    ['ident', 'w'], ['punct', '='], ['punct', '-'], ['number', '40.5e1'], ['punct', ';'],
    ['ident', '$fn'], ['punct', '='], ['number', '8'], ['punct', ';'],
    ['ident', 's'], ['punct', '='], ['string', '"x"'], ['punct', ';'],
    ['eof', ''],
  ])
})

it('lexes numbers with a leading dot, a trailing dot and exponents', () => {
  expect(significant('.5 1. 2e-3 7E+2')).toEqual([
    ['number', '.5'], ['number', '1.'], ['number', '2e-3'], ['number', '7E+2'], ['eof', ''],
  ])
})

it('keeps // and /* inside a string as part of the string', () => {
  expect(significant('url = "http://x/*y*/"; // note')).toEqual([
    ['ident', 'url'], ['punct', '='], ['string', '"http://x/*y*/"'], ['punct', ';'], ['comment', '// note'], ['eof', ''],
  ])
})

it('handles escaped quotes and backslashes inside strings', () => {
  expect(significant(String.raw`a = "say \"hi\" \\"; b = 1;`).slice(0, 4)).toEqual([
    ['ident', 'a'], ['punct', '='], ['string', String.raw`"say \"hi\" \\"`], ['punct', ';'],
  ])
})

it('treats line and block comments as single tokens, even with quotes and code inside', () => {
  expect(significant(`// it's "fine" = 3;\n/* depth = 3; */\n/* [Group] */`)).toEqual([
    ['comment', `// it's "fine" = 3;`], ['comment', '/* depth = 3; */'], ['comment', '/* [Group] */'], ['eof', ''],
  ])
})

it('lexes include and use paths as one string token, including paths with //', () => {
  expect(significant('include <BOSL2/std.scad>\nuse <a//b.scad>\nx = a < b;')).toEqual([
    ['ident', 'include'], ['string', '<BOSL2/std.scad>'],
    ['ident', 'use'], ['string', '<a//b.scad>'],
    ['ident', 'x'], ['punct', '='], ['ident', 'a'], ['punct', '<'], ['ident', 'b'], ['punct', ';'],
    ['eof', ''],
  ])
})

it('keeps two-character operators together', () => {
  expect(significant('a<=b&&c!=d||e==f>=g').filter(([k]) => k === 'punct').map(([, t]) => t)).toEqual([
    '<=', '&&', '!=', '||', '==', '>=',
  ])
})

it('records start and end offsets and 1-based start lines', () => {
  const tokens = lex('a = 1;\n\n/* two\nlines */ b')
  const find = (text: string) => tokens.find((t) => t.text === text) as Token
  expect(find('a')).toMatchObject({ start: 0, end: 1, line: 1 })
  expect(find('/* two\nlines */')).toMatchObject({ line: 3 })
  expect(find('b')).toMatchObject({ line: 4 })
  expect(tokens.at(-1)).toMatchObject({ kind: 'eof', line: 4, start: 25, end: 25 })
})

it('runs an unterminated string or block comment to the end of the input', () => {
  expect(significant('s = "open')).toEqual([['ident', 's'], ['punct', '='], ['string', '"open'], ['eof', '']])
  expect(significant('/* open')).toEqual([['comment', '/* open'], ['eof', '']])
})

it('is lossless: the token texts join back into the source', () => {
  const code = 'include <x.scad>\n/* [A] */\nw = 40; // [10:1:200]\nmodule m() { cube([w, 2, -3.5]); }\n"unterminated'
  expect(lex(code).map((t) => t.text).join('')).toBe(code)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scad/lexer.test.ts`
Expected: FAIL with "Failed to resolve import './lexer'".

- [ ] **Step 3: Write minimal implementation**

`src/scad/lexer.ts`:

```ts
export type TokenKind = 'ident' | 'number' | 'string' | 'punct' | 'comment' | 'whitespace' | 'eof'

export interface Token {
  kind: TokenKind
  text: string
  start: number
  end: number
  /** 1-based line the token starts on. */
  line: number
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const TWO_CHAR = new Set(['==', '!=', '<=', '>=', '&&', '||'])

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n'
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdentPart = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c)

/** Comment-, string- and include-path-aware tokens for the Customizer and statement scanners (D7). */
export function lex(code: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  // After `include` or `use`, the next `<…>` is a file path, not a comparison.
  let expectPath = false

  const push = (kind: TokenKind, end: number) => {
    tokens.push({ kind, text: code.slice(i, end), start: i, end, line })
    for (let k = i; k < end; k++) if (code.charCodeAt(k) === 10) line++
    i = end
  }

  while (i < code.length) {
    const c = code[i]!

    if (isSpace(c)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j]!)) j++
      push('whitespace', j)
      continue
    }

    if (c === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i)
      push('comment', nl === -1 ? code.length : nl)
      continue
    }

    if (c === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2)
      push('comment', close === -1 ? code.length : close + 2)
      continue
    }

    if (c === '"') {
      let j = i + 1
      while (j < code.length && code[j] !== '"') j += code[j] === '\\' ? 2 : 1
      push('string', Math.min(j + 1, code.length))
      expectPath = false
      continue
    }

    if (expectPath && c === '<') {
      const close = code.indexOf('>', i)
      const nl = code.indexOf('\n', i)
      const end = close !== -1 && (nl === -1 || close < nl) ? close + 1 : nl === -1 ? code.length : nl
      push('string', end)
      expectPath = false
      continue
    }

    if (isDigit(c) || (c === '.' && isDigit(code[i + 1]))) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(code)!
      push('number', i + m[0].length)
      expectPath = false
      continue
    }

    if (isIdentStart(c)) {
      let j = i + 1
      while (isIdentPart(code[j])) j++
      const word = code.slice(i, j)
      push('ident', j)
      expectPath = word === 'include' || word === 'use'
      continue
    }

    push('punct', i + (TWO_CHAR.has(code.slice(i, i + 2)) ? 2 : 1))
    expectPath = false
  }

  tokens.push({ kind: 'eof', text: '', start: code.length, end: code.length, line })
  return tokens
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scad/lexer.test.ts && npm run typecheck`
Expected: PASS (10 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/scad/lexer.ts src/scad/lexer.test.ts
git commit -m "feat(scad): comment-, string- and include-aware OpenSCAD lexer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Customizer parser, overrides and bake

**Files:**
- Create: `src/render/params.ts`, `src/scad/customizer.ts`
- Test: `src/render/params.test.ts`, `src/scad/customizer.test.ts`

**Interfaces:**
- Consumes: `lex`, `Token` (Task 1); `ParamValue` (`src/render/types.ts`, M1).
- Produces:
  - `src/render/params.ts`: `type Params = Record<string, ParamValue>`; `paramValueEqual(a: ParamValue, b: ParamValue): boolean`; `paramsEqual(a: Params | null | undefined, b: Params | null | undefined): boolean` (null/undefined equal `{}`).
  - `src/scad/customizer.ts` (contract): `ParamControl`, `CustomizerParam`, `parseCustomizer(code: string): CustomizerParam[]`, `bakeParams(code: string, values: Record<string, ParamValue>): string`.
  - Extra exports: `paramOverrides(code: string, params: Params): Params` (only visible parameters whose value has the default's type and differs from it); `effectiveValues(code: string, params: Params): Params` (every visible parameter's default, replaced by a valid override).
- Rules (OpenSCAD Customizer): only assignments at bracket depth 0 that start a statement, before the first `module` or `function` keyword; names starting with `$` are skipped; the default must be a literal (number, `-number`, string, `true`/`false`, or a vector of 1–4 numbers), otherwise the assignment is not customizable and is skipped (a later non-literal assignment to the same name removes it); a later literal assignment to the same name wins and takes its position. `/* [Name] */` at depth 0 starts a group; `/* [Hidden] */` hides what follows until the next group. The annotation is the `//` comment on the same line right after the `;`. The description is a comment alone on the line directly above (not a group marker, not the previous line's trailing annotation).

| Annotation on a number | Control |
| --- | --- |
| `// [10:1:200]` | `slider` min 10, step 1, max 200 |
| `// [10:200]` | `slider` min 10, max 200, step 1 (0.1, 0.01 … when min, max or the default has decimals) |
| `// [50]` | `slider` 0 to 50, step 1 |
| `// 0.5` | `number` with step 0.5 |
| `// [1, 2, 4]`, `// [1:One, 2:Two]` | `dropdown` with number values |
| none or unrecognised | `number`, `annotated: false` |

Strings: `// [round, square]` or `// [S:Small, M:Medium]` → `dropdown` with string values; otherwise `text`. Booleans → `toggle`. Vectors → `vector` with their length.

- [ ] **Step 1: Write the failing tests**

`src/render/params.test.ts`:

```ts
import { paramsEqual, paramValueEqual } from './params'

it('compares scalar and vector parameter values', () => {
  expect(paramValueEqual(1, 1)).toBe(true)
  expect(paramValueEqual('a', 'a')).toBe(true)
  expect(paramValueEqual(true, false)).toBe(false)
  expect(paramValueEqual([1, 2], [1, 2])).toBe(true)
  expect(paramValueEqual([1, 2], [1, 2, 3])).toBe(false)
  expect(paramValueEqual([1], 1)).toBe(false)
})

it('compares parameter maps by keys and values, treating null as empty', () => {
  expect(paramsEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true)
  expect(paramsEqual({ a: 1 }, { a: 2 })).toBe(false)
  expect(paramsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  expect(paramsEqual(null, {})).toBe(true)
  expect(paramsEqual(undefined, { a: 1 })).toBe(false)
})
```

`src/scad/customizer.test.ts`:

```ts
import { bakeParams, effectiveValues, paramOverrides, parseCustomizer } from './customizer'

const byName = (code: string) => Object.fromEntries(parseCustomizer(code).map((p) => [p.name, p]))

describe('controls from the spec table', () => {
  const code = [
    'w = 40; // [10:1:200]',
    'h = 12; // [10:200]',
    'r = 1.5; // [0.5:3]',
    'm = 30; // [50]',
    't = 2; // 0.5',
    'shape = "round"; // [round, square]',
    'size_name = "M"; // [S:Small, M:Medium]',
    'teeth = 2; // [1:One, 2:Two]',
    'pa = 20; // [14.5, 20, 25]',
    'holes = true;',
    'label = "ABC";',
    'size = [20, 30, 5];',
    'n = 7;',
  ].join('\n')
  const p = byName(code)

  it('builds sliders from [min:step:max], [min:max] and [max]', () => {
    expect(p.w).toMatchObject({ defaultValue: 40, control: { kind: 'slider', min: 10, step: 1, max: 200 }, annotated: true, line: 1 })
    expect(p.h!.control).toEqual({ kind: 'slider', min: 10, step: 1, max: 200 })
    expect(p.r!.control).toEqual({ kind: 'slider', min: 0.5, step: 0.1, max: 3 })
    expect(p.m!.control).toEqual({ kind: 'slider', min: 0, step: 1, max: 50 })
  })

  it('builds a stepped number input from a bare number', () => {
    expect(p.t!.control).toEqual({ kind: 'number', step: 0.5 })
  })

  it('builds dropdowns with string or number values and optional labels', () => {
    expect(p.shape!.control).toEqual({
      kind: 'dropdown',
      options: [{ value: 'round', label: 'round' }, { value: 'square', label: 'square' }],
    })
    expect(p.size_name!.control).toEqual({
      kind: 'dropdown',
      options: [{ value: 'S', label: 'Small' }, { value: 'M', label: 'Medium' }],
    })
    expect(p.teeth!.control).toEqual({ kind: 'dropdown', options: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }] })
    expect(p.pa!.control).toEqual({
      kind: 'dropdown',
      options: [{ value: 14.5, label: '14.5' }, { value: 20, label: '20' }, { value: 25, label: '25' }],
    })
  })

  it('builds a toggle, a text input and a vector input from the value type', () => {
    expect(p.holes).toMatchObject({ defaultValue: true, control: { kind: 'toggle' } })
    expect(p.label).toMatchObject({ defaultValue: 'ABC', control: { kind: 'text' } })
    expect(p.size).toMatchObject({ defaultValue: [20, 30, 5], control: { kind: 'vector', length: 3 } })
  })

  it('gives an un-annotated number a plain number input and marks it un-annotated', () => {
    expect(p.n).toMatchObject({ defaultValue: 7, control: { kind: 'number' }, annotated: false })
  })
})

describe('groups, hidden parameters and descriptions', () => {
  const code = [
    '// Outer width',
    'width = 20; // [5:1:100]',
    '/* [Lid] */',
    'lid = 2; // [1:5]',
    '',
    '// not attached: blank line below',
    '',
    'gap = 0.2; // 0.05',
    '/* [Hidden] */',
    'secret = 1;',
    '/* [Extras] */',
    'a = 1; // [0:10]',
    'b = 2;',
  ].join('\n')

  it('assigns groups in order and hides everything after [Hidden] until the next group', () => {
    expect(parseCustomizer(code).map((p) => [p.name, p.group])).toEqual([
      ['width', ''], ['lid', 'Lid'], ['gap', 'Lid'], ['a', 'Extras'], ['b', 'Extras'],
    ])
  })

  it('takes the description from a comment alone on the line directly above', () => {
    const p = byName(code)
    expect(p.width!.description).toBe('Outer width')
    expect(p.gap!.description).toBe('')
  })

  it("does not take the previous line's trailing annotation as a description", () => {
    expect(byName(code).b!.description).toBe('')
  })
})

describe('what is not a Customizer parameter', () => {
  it('stops at the first module or function definition', () => {
    const code = 'a = 1;\nmodule m() { inner = 3; cube(inner); }\nb = 2;\nfunction f() = 1;\nc = 3;'
    expect(parseCustomizer(code).map((p) => p.name)).toEqual(['a'])
    expect(parseCustomizer('function f(x) = x;\nz = 1;')).toEqual([])
  })

  it('ignores assignments that are not at top level', () => {
    const code = 'if (true) { x = 1; }\nfor (i = [0:2]) cube(i);\ntranslate([1, 0, 0]) { y = 2; }\nz = 3;'
    expect(parseCustomizer(code).map((p) => p.name)).toEqual(['z'])
  })

  it('skips expressions, references, ranges, nested vectors and special variables', () => {
    const code = [
      'a = 10 * 2;', 'b = a;', 'c = PI;', 'd = -a;', 'e = [0:10];', 'f = [[1, 2], [3, 4]];',
      'g = [1, [2]];', 'h = [];', 'i = [1, 2, 3, 4, 5];', '$fn = 64;', 'j = 5;',
    ].join('\n')
    expect(parseCustomizer(code).map((p) => p.name)).toEqual(['j'])
  })

  it('finds no parameters inside comments or strings that look like assignments', () => {
    const code = [
      '/* depth = 3; // [1:10] */',
      'label = "w = 5; // [1:10]"; // the label',
      '// width = 9;',
      'url = "http://x/y";',
    ].join('\n')
    const params = parseCustomizer(code)
    expect(params.map((p) => p.name)).toEqual(['label', 'url'])
    expect(params[0]).toMatchObject({ defaultValue: 'w = 5; // [1:10]', control: { kind: 'text' }, annotated: false })
    expect(params[1]!.defaultValue).toBe('http://x/y')
  })

  it('finds parameters after include and use lines', () => {
    expect(parseCustomizer('include <BOSL2/std.scad>\nuse <MCAD/boxes.scad>\nw = 2; // [1:5]').map((p) => p.name)).toEqual(['w'])
  })

  it('does not throw on malformed input', () => {
    for (const code of ['w = ;', 'w = 3', 'w = (;', '= 4;', 'w = "open', '/* [Lid', ')))]]]};;;', '']) {
      expect(() => parseCustomizer(code)).not.toThrow()
    }
    expect(parseCustomizer('w = ;\nh = 3')).toEqual([])
  })
})

describe('literal parsing', () => {
  it('reads negative numbers, negative vector items and string escapes', () => {
    const p = byName(String.raw`x = -5; // [-10:1:10]
v = [-1, 2.5, -3e1];
s = "say \"hi\"\n";`)
    expect(p.x).toMatchObject({ defaultValue: -5, control: { kind: 'slider', min: -10, step: 1, max: 10 } })
    expect(p.v!.defaultValue).toEqual([-1, 2.5, -30])
    expect(p.s!.defaultValue).toBe('say "hi"\n')
  })

  it('lets a later literal assignment win and a later expression remove the parameter', () => {
    expect(byName('w = 1; // [0:5]\nw = 3; // [0:10]').w).toMatchObject({ defaultValue: 3, line: 2 })
    expect(byName('w = 1;\nw = w + 1;').w).toBeUndefined()
  })

  it('falls back to a plain number input when an annotation is not usable', () => {
    for (const note of ['[10:1:5]', '[0:0:10]', '[[1, 2]]', '[]', 'the width', '[a:b:c:d:e]']) {
      expect(byName(`w = 4; // ${note}`).w).toMatchObject({ control: { kind: 'number' }, annotated: false })
    }
  })

  it('does not use a slider annotation on a string, nor a step on a string', () => {
    expect(byName('s = "a"; // 8').s).toMatchObject({ control: { kind: 'text' }, annotated: false })
  })
})

describe('bakeParams', () => {
  const code = '/* [Size] */\nw = 40; // [10:1:200]\nlabel = "A";\nsize = [1, 2];\non = true;\n/* [Hidden] */\nk = 9;\n'

  it('rewrites only the default values, keeping comments and layout', () => {
    expect(bakeParams(code, { w: -12.5, label: 'say "hi"', size: [3, 4], on: false, k: 1, missing: 2 })).toBe(
      '/* [Size] */\nw = -12.5; // [10:1:200]\nlabel = "say \\"hi\\"";\nsize = [3, 4];\non = false;\n/* [Hidden] */\nk = 9;\n',
    )
  })

  it('ignores values whose type does not match the default', () => {
    expect(bakeParams(code, { w: 'x', size: [1, 2, 3] })).toBe(code)
  })

  it('round-trips: parsing the baked code gives the baked values as defaults', () => {
    const baked = bakeParams(code, { w: 77, size: [5, 6] })
    expect(effectiveValues(baked, {})).toEqual({ w: 77, label: 'A', size: [5, 6], on: true })
  })
})

describe('paramOverrides and effectiveValues', () => {
  const code = 'w = 40; // [10:1:200]\nlabel = "A";\nsize = [1, 2];\n/* [Hidden] */\nk = 9;'

  it('keeps only known, visible parameters whose value has the right type and differs from the default', () => {
    expect(paramOverrides(code, { w: 40, label: 'B', size: [1, 2, 3], k: 1, gone: 3 })).toEqual({ label: 'B' })
    expect(paramOverrides(code, { w: '40' })).toEqual({})
  })

  it('merges valid overrides over the defaults', () => {
    expect(effectiveValues(code, { w: 50, size: ['x'] as unknown as number[] })).toEqual({ w: 50, label: 'A', size: [1, 2] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/params.test.ts src/scad/customizer.test.ts`
Expected: FAIL with "Failed to resolve import './params'" and "Failed to resolve import './customizer'".

- [ ] **Step 3: Write minimal implementation**

`src/render/params.ts`:

```ts
import type { ParamValue } from './types'

export type Params = Record<string, ParamValue>

export function paramValueEqual(a: ParamValue, b: ParamValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
  }
  return a === b
}

export function paramsEqual(a: Params | null | undefined, b: Params | null | undefined): boolean {
  const x = a ?? {}
  const y = b ?? {}
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => k in y && paramValueEqual(x[k]!, y[k]!))
}
```

`src/scad/customizer.ts`:

```ts
import { paramValueEqual, type Params } from '../render/params'
import type { ParamValue } from '../render/types'
import { lex, type Token } from './lexer'

export type ParamControl =
  | { kind: 'slider'; min: number; step: number; max: number }
  | { kind: 'number'; step?: number }
  | { kind: 'dropdown'; options: Array<{ value: string | number; label: string }> }
  | { kind: 'toggle' }
  | { kind: 'text' }
  | { kind: 'vector'; length: number }

export interface CustomizerParam {
  name: string
  defaultValue: ParamValue
  control: ParamControl
  group: string // '' when no /* [Group] */ precedes it
  description: string // comment on the line above, if any
  line: number
  annotated: boolean
}

interface Assignment {
  name: string
  value: ParamValue
  valueStart: number
  valueEnd: number
  line: number
  group: string
  hidden: boolean
  description: string
  annotation: string | null
}

const GROUP = /^\/\*\s*\[\s*([^\]]*?)\s*\]\s*\*\/$/
const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const OPEN = new Set(['(', '[', '{'])
const CLOSE = new Set([')', ']', '}'])

const isTrivia = (t: Token) => t.kind === 'whitespace' || t.kind === 'comment'

function nextSignificant(tokens: Token[], from: number): number {
  let j = from
  while (j < tokens.length && isTrivia(tokens[j]!)) j++
  return j
}

/** Index of the `;` that ends the statement starting at `from`, or -1 if it is malformed. */
function statementEnd(tokens: Token[], from: number): number {
  let depth = 0
  for (let j = from; j < tokens.length; j++) {
    const t = tokens[j]!
    if (t.kind === 'eof') return -1
    if (t.kind !== 'punct') continue
    if (OPEN.has(t.text)) depth++
    else if (CLOSE.has(t.text)) {
      if (depth === 0) return -1
      depth--
    } else if (t.text === ';' && depth === 0) return j
  }
  return -1
}

function unescape(body: string): string {
  return body.replace(/\\(.)/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c)
}

function readNumber(ts: Token[], k: number): [number, number] | null {
  const negative = ts[k]?.text === '-'
  const t = ts[negative ? k + 1 : k]
  if (!t || t.kind !== 'number') return null
  const n = Number(t.text)
  if (!Number.isFinite(n)) return null
  return [negative ? -n : n, negative ? k + 2 : k + 1]
}

function parseLiteral(ts: Token[]): ParamValue | undefined {
  if (ts.length === 0) return undefined
  const first = ts[0]!
  if (ts.length === 1) {
    if (first.kind === 'string' && first.text.length >= 2 && first.text.startsWith('"') && first.text.endsWith('"')) {
      return unescape(first.text.slice(1, -1))
    }
    if (first.kind === 'ident' && (first.text === 'true' || first.text === 'false')) return first.text === 'true'
  }
  const scalar = readNumber(ts, 0)
  if (scalar && scalar[1] === ts.length) return scalar[0]
  if (first.text !== '[' || ts.at(-1)!.text !== ']') return undefined
  const items: number[] = []
  let k = 1
  while (k < ts.length - 1) {
    const n = readNumber(ts, k)
    if (!n) return undefined
    items.push(n[0])
    k = n[1]
    if (k < ts.length - 1) {
      if (ts[k]!.text !== ',') return undefined
      k++
    }
  }
  return items.length >= 1 && items.length <= 4 ? items : undefined
}

function descriptionAbove(tokens: Token[], identIndex: number): string {
  let j = identIndex - 1
  const ws = tokens[j]
  if (!ws || ws.kind !== 'whitespace' || ws.text.split('\n').length !== 2) return ''
  j--
  const c = tokens[j]
  if (!c || c.kind !== 'comment' || GROUP.test(c.text)) return ''
  const before = tokens[j - 1]
  if (before && !(before.kind === 'whitespace' && before.text.includes('\n'))) return ''
  return c.text.startsWith('//') ? c.text.slice(2).trim() : c.text.slice(2, -2).trim()
}

function annotationAfter(tokens: Token[], semicolon: number): string | null {
  let j = semicolon + 1
  if (tokens[j]?.kind === 'whitespace') {
    if (tokens[j]!.text.includes('\n')) return null
    j++
  }
  const c = tokens[j]
  return c?.kind === 'comment' && c.text.startsWith('//') ? c.text.slice(2).trim() : null
}

function scanAssignments(code: string): Assignment[] {
  const tokens = lex(code)
  const found = new Map<string, Assignment>()
  let group = ''
  let hidden = false
  let depth = 0
  let atStart = true

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === 'eof') break
    if (t.kind === 'whitespace') continue
    if (t.kind === 'comment') {
      const m = depth === 0 ? GROUP.exec(t.text) : null
      if (m) {
        hidden = m[1]!.toLowerCase() === 'hidden'
        group = hidden ? '' : m[1]!
      }
      continue
    }

    if (depth === 0 && atStart && t.kind === 'ident') {
      if (t.text === 'module' || t.text === 'function') break
      const next = nextSignificant(tokens, i + 1)
      if ((t.text === 'include' || t.text === 'use') && tokens[next]?.kind === 'string') {
        i = next
        continue
      }
      if (tokens[next]?.text === '=') {
        const end = statementEnd(tokens, next + 1)
        if (end !== -1) {
          const valueTokens = tokens.slice(next + 1, end).filter((x) => !isTrivia(x))
          const value = parseLiteral(valueTokens)
          found.delete(t.text)
          if (value !== undefined && !t.text.startsWith('$')) {
            found.set(t.text, {
              name: t.text,
              value,
              valueStart: valueTokens[0]!.start,
              valueEnd: valueTokens.at(-1)!.end,
              line: t.line,
              group,
              hidden,
              description: descriptionAbove(tokens, i),
              annotation: annotationAfter(tokens, end),
            })
          }
          i = end
          atStart = true
          continue
        }
      }
    }

    if (t.kind === 'punct') {
      if (OPEN.has(t.text)) depth++
      else if (CLOSE.has(t.text)) depth = Math.max(0, depth - 1)
    }
    atStart = depth === 0 && (t.text === ';' || t.text === '}')
  }
  return [...found.values()]
}

const decimals = (n: number) => {
  const s = String(n)
  const dot = s.indexOf('.')
  return dot === -1 || s.includes('e') ? 0 : s.length - dot - 1
}

function parseAnnotation(text: string, value: number | string): ParamControl | null {
  const bracket = /^\[([^[\]]*)\]$/.exec(text)
  if (!bracket) {
    if (typeof value === 'number' && NUM.test(text) && Number(text) > 0) return { kind: 'number', step: Number(text) }
    return null
  }
  const inner = bracket[1]!.trim()
  if (inner === '') return null
  const items = inner.split(',').map((s) => s.trim())

  if (items.length === 1 && typeof value === 'number') {
    const parts = items[0]!.split(':').map((s) => s.trim())
    if (parts.every((p) => NUM.test(p))) {
      const n = parts.map(Number)
      let min: number, step: number, max: number
      if (n.length === 1) [min, step, max] = [0, 1, n[0]!]
      else if (n.length === 2) {
        ;[min, max] = [n[0]!, n[1]!]
        step = 10 ** -Math.max(decimals(min), decimals(max), decimals(value))
      } else if (n.length === 3) [min, step, max] = [n[0]!, n[1]!, n[2]!]
      else return null
      return min < max && step > 0 ? { kind: 'slider', min, step, max } : null
    }
  }

  const options: Array<{ value: string | number; label: string }> = []
  for (const item of items) {
    const colon = item.indexOf(':')
    const raw = (colon === -1 ? item : item.slice(0, colon)).trim()
    const label = (colon === -1 ? item : item.slice(colon + 1)).trim()
    if (raw === '' || label === '') return null
    if (typeof value === 'number') {
      if (!NUM.test(raw)) return null
      options.push({ value: Number(raw), label })
    } else options.push({ value: raw, label })
  }
  return { kind: 'dropdown', options }
}

function toParam(a: Assignment): CustomizerParam {
  const base = { name: a.name, defaultValue: a.value, group: a.group, description: a.description, line: a.line }
  const v = a.value
  if (typeof v === 'boolean') return { ...base, control: { kind: 'toggle' }, annotated: a.annotation !== null }
  if (Array.isArray(v)) {
    const usable = a.annotation !== null && parseAnnotation(a.annotation, 0) !== null
    return { ...base, control: { kind: 'vector', length: v.length }, annotated: usable }
  }
  const parsed = a.annotation === null ? null : parseAnnotation(a.annotation, v)
  if (parsed) return { ...base, control: parsed, annotated: true }
  return { ...base, control: typeof v === 'number' ? { kind: 'number' } : { kind: 'text' }, annotated: false }
}

export function parseCustomizer(code: string): CustomizerParam[] {
  return scanAssignments(code)
    .filter((a) => !a.hidden)
    .map(toParam)
}

function sameType(v: ParamValue, d: ParamValue): boolean {
  if (Array.isArray(d)) return Array.isArray(v) && v.length === d.length && v.every((x) => typeof x === 'number' && Number.isFinite(x))
  if (typeof d === 'number') return typeof v === 'number' && Number.isFinite(v)
  return typeof v === typeof d
}

function bakeLiteral(v: ParamValue): string {
  if (Array.isArray(v)) return `[${v.map(String).join(', ')}]`
  if (typeof v === 'string') return JSON.stringify(v)
  return String(v)
}

/** Rewrites the default values in source ("Bake into code"). */
export function bakeParams(code: string, values: Record<string, ParamValue>): string {
  const edits = scanAssignments(code)
    .filter((a) => !a.hidden && Object.hasOwn(values, a.name) && sameType(values[a.name]!, a.value))
    .sort((x, y) => y.valueStart - x.valueStart)
  let out = code
  for (const a of edits) out = out.slice(0, a.valueStart) + bakeLiteral(values[a.name]!) + out.slice(a.valueEnd)
  return out
}

/** The values to send as `-D` overrides: visible parameters whose value is valid and differs from the default. */
export function paramOverrides(code: string, params: Params): Params {
  const out: Params = {}
  for (const p of parseCustomizer(code)) {
    if (!Object.hasOwn(params, p.name)) continue
    const v = params[p.name]!
    if (sameType(v, p.defaultValue) && !paramValueEqual(v, p.defaultValue)) out[p.name] = v
  }
  return out
}

/** Every visible parameter's current value: the default, or a valid override. */
export function effectiveValues(code: string, params: Params): Params {
  const out: Params = {}
  for (const p of parseCustomizer(code)) {
    const v = Object.hasOwn(params, p.name) ? params[p.name]! : undefined
    out[p.name] = v !== undefined && sameType(v, p.defaultValue) ? v : p.defaultValue
  }
  return out
}
```

Note: `Object.hasOwn` is ES2022, matching `tsconfig.json`'s `lib`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render/params.test.ts src/scad/customizer.test.ts && npm run typecheck`
Expected: PASS (2 + 23 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/params.ts src/render/params.test.ts src/scad/customizer.ts src/scad/customizer.test.ts
git commit -m "feat(scad): Customizer parser with groups, annotations, overrides and bake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Parameters in the store and the render loop

**Files:**
- Modify: `src/state/store.ts`, `src/render/useRenderLoop.ts`
- Test: `src/state/store.test.ts`, `src/render/useRenderLoop.test.ts`

**Interfaces:**
- Consumes: `Params`, `paramsEqual` (Task 2); `paramOverrides` (Task 2); M2 store contract (`CodeSource`, `codeSource`, `lastRender`, `setCode(code, source)`, `view`, `setView`).
- Produces (store, contract plus M3):
  - `params: Params` (the values the person set, raw), `renderedParams: Params | null` (the `params` snapshot that produced `mesh`/`stl`), `setParams(params: Params): void`.
  - `libraries: string[]`, `setLibraries(libraries: string[]): void` (the open project's enabled libraries; the render loop reads them).
  - `view: 'workbench' | 'settings' | 'history' | 'gallery'`.
  - `setCode(code, source = 'manual')`: an `'ai'` or `'autofix'` source also clears `params` (the AI edits the defaults, so old slider values must not mask them).
  - `renderFinished(result: RenderResult, code: string, params: Params = {}): void` sets `lastRender` on every result and `renderedParams` on success.
  - `selectCanExport` also requires `paramsEqual(renderedParams, params)`.
  - `src/render/useRenderLoop.ts`: `buildRenderRequest(code: string, params: Params, libraries: string[]): RenderRequest` (omits `params` and `libraries` when empty); the loop re-requests on `code` or `params` changes (debounced) and on `libraries` changes (immediately).

- [ ] **Step 1: Write the failing tests**

Append to `src/state/store.test.ts`:

```ts
describe('parameters (M3)', () => {
  it('stores parameters and keeps them across manual edits', () => {
    useAppStore.getState().setParams({ width: 30 })
    useAppStore.getState().setCode('cube(1);')
    expect(useAppStore.getState().params).toEqual({ width: 30 })
    expect(useAppStore.getState().codeSource).toBe('manual')
  })

  it('clears parameters when the AI or auto-fix replaces the code', () => {
    useAppStore.getState().setParams({ width: 30 })
    useAppStore.getState().setCode('cube(2);', 'ai')
    expect(useAppStore.getState().params).toEqual({})
    useAppStore.getState().setParams({ width: 31 })
    useAppStore.getState().setCode('cube(3);', 'autofix')
    expect(useAppStore.getState().params).toEqual({})
  })

  it('keeps parameters for a restore, so the caller can set the version params after it', () => {
    useAppStore.getState().setParams({ width: 30 })
    useAppStore.getState().setCode('cube(2);', 'restore')
    expect(useAppStore.getState().params).toEqual({ width: 30 })
  })

  it('records the parameters of a successful render and the last result of any render', () => {
    const ok = okResult()
    useAppStore.getState().renderFinished(ok, DEFAULT_CODE, { width: 30 })
    expect(useAppStore.getState().renderedParams).toEqual({ width: 30 })
    expect(useAppStore.getState().lastRender).toEqual({ code: DEFAULT_CODE, result: ok })
    const failed = errorResult()
    useAppStore.getState().renderFinished(failed, DEFAULT_CODE, { width: 31 })
    expect(useAppStore.getState().renderedParams).toEqual({ width: 30 })
    expect(useAppStore.getState().lastRender).toEqual({ code: DEFAULT_CODE, result: failed })
  })

  it('allows STL export only when the rendered parameters equal the current ones', () => {
    useAppStore.getState().setParams({ width: 30 })
    useAppStore.getState().renderFinished(okResult(), DEFAULT_CODE, { width: 30 })
    expect(selectCanExport(useAppStore.getState())).toBe(true)
    useAppStore.getState().setParams({ width: 31 })
    expect(selectCanExport(useAppStore.getState())).toBe(false)
    useAppStore.getState().renderFinished(okResult(), DEFAULT_CODE, { width: 31 })
    expect(selectCanExport(useAppStore.getState())).toBe(true)
  })

  it('stores the enabled libraries and accepts the history and gallery views', () => {
    useAppStore.getState().setLibraries(['BOSL2'])
    useAppStore.getState().setView('history')
    expect(useAppStore.getState()).toMatchObject({ libraries: ['BOSL2'], view: 'history' })
    useAppStore.getState().setView('gallery')
    expect(useAppStore.getState().view).toBe('gallery')
  })
})
```

Append to `src/render/useRenderLoop.test.ts`:

```ts
it('sends only the parameters that differ from the source defaults, and records what it rendered', async () => {
  const { requests, createWorker } = instantWorker()
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(0))

  act(() => useAppStore.getState().setParams({ width: 30, depth: 20, nope: 1 }))
  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(requests[1]).toEqual({ code: DEFAULT_CODE, params: { width: 30 } })
  expect(useAppStore.getState().renderedParams).toEqual({ width: 30, depth: 20, nope: 1 })
  expect(useAppStore.getState().lastRender?.code).toBe(DEFAULT_CODE)
})

it('re-renders at once with the libraries when they change', async () => {
  const { requests, createWorker } = instantWorker()
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(0))

  act(() => useAppStore.getState().setLibraries(['BOSL2']))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(requests[1]).toEqual({ code: DEFAULT_CODE, libraries: ['BOSL2'] })
})

it('builds requests without empty params or libraries', () => {
  expect(buildRenderRequest('w = 1; // [0:5]\ncube(w);', { w: 1 }, [])).toEqual({ code: 'w = 1; // [0:5]\ncube(w);' })
  expect(buildRenderRequest('w = 1; // [0:5]', { w: 2 }, ['MCAD'])).toEqual({
    code: 'w = 1; // [0:5]',
    params: { w: 2 },
    libraries: ['MCAD'],
  })
})
```

and change its import line to:

```ts
import { buildRenderRequest, useRenderLoop } from './useRenderLoop'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/store.test.ts src/render/useRenderLoop.test.ts`
Expected: FAIL: "setParams is not a function", "buildRenderRequest is not a function" (and TypeScript errors in the editor for the new fields).

- [ ] **Step 3: Write minimal implementation**

`src/state/store.ts`: this is M1's file plus M2's contract additions plus M3's. Replace the type and store definitions with the following; if M2 added anything not shown here (for example extra fields or actions), keep it unchanged alongside.

```ts
import { create } from 'zustand'
import { paramsEqual, type Params } from '../render/params'
import type { Diagnostic, LogLine, MeshData, RenderResult } from '../render/types'

export type RenderStatus = 'idle' | 'rendering' | 'ok' | 'error'

export interface RevealRequest {
  line: number
  id: number
}

// DEFAULT_CODE stays exactly as in M1.

export type CodeSource = 'manual' | 'ai' | 'autofix' | 'restore' | 'slider' | 'gallery' | 'import'

export interface AppState {
  code: string
  status: RenderStatus
  /** Last successfully rendered mesh; kept on screen when a later render fails. */
  mesh: MeshData | null
  /** Binary STL matching `mesh`. */
  stl: ArrayBuffer | null
  /** The code that produced `mesh` and `stl`. */
  renderedCode: string | null
  /** The `params` snapshot that produced `mesh` and `stl` (M3). */
  renderedParams: Params | null
  logs: LogLine[]
  diagnostics: Diagnostic[]
  error: string | null
  renderMs: number | null
  /** Asks the editor to scroll to and select a line (status pill and console clicks). */
  reveal: RevealRequest | null
  codeSource: CodeSource
  /** The last finished render and the code it belongs to; awaitRender() reads it. */
  lastRender: { code: string; result: RenderResult } | null
  view: 'workbench' | 'settings' | 'history' | 'gallery'
  /** Customizer values the person set (M3). Only those that differ from the defaults are sent as -D. */
  params: Params
  /** The open project's enabled libraries (M3). */
  libraries: string[]
  setCode(code: string, source?: CodeSource): void
  setParams(params: Params): void
  setLibraries(libraries: string[]): void
  setView(view: AppState['view']): void
  renderStarted(): void
  renderFinished(result: RenderResult, code: string, params?: Params): void
  goToLine(line: number): void
}

let revealId = 0

export const useAppStore = create<AppState>()((set) => ({
  code: DEFAULT_CODE,
  status: 'idle',
  mesh: null,
  stl: null,
  renderedCode: null,
  renderedParams: null,
  logs: [],
  diagnostics: [],
  error: null,
  renderMs: null,
  reveal: null,
  codeSource: 'manual',
  lastRender: null,
  view: 'workbench',
  params: {},
  libraries: [],
  setCode: (code, source = 'manual') =>
    set(source === 'ai' || source === 'autofix' ? { code, codeSource: source, params: {} } : { code, codeSource: source }),
  setParams: (params) => set({ params }),
  setLibraries: (libraries) => set({ libraries }),
  setView: (view) => set({ view }),
  renderStarted: () => set({ status: 'rendering' }),
  renderFinished: (r, code, params = {}) =>
    set(
      r.ok
        ? {
            status: 'ok',
            mesh: r.mesh,
            stl: r.stl,
            renderedCode: code,
            renderedParams: params,
            error: null,
            logs: r.logs,
            diagnostics: r.diagnostics,
            renderMs: r.renderMs,
            lastRender: { code, result: r },
          }
        : { status: 'error', error: r.error, logs: r.logs, diagnostics: r.diagnostics, renderMs: r.renderMs, lastRender: { code, result: r } },
    ),
  goToLine: (line) => set({ reveal: { line, id: ++revealId } }),
}))

/** STL export is allowed only when the file on hand was rendered from exactly the code and parameters in the editor. */
export const selectCanExport = (s: AppState): boolean =>
  s.status === 'ok' && s.stl !== null && s.renderedCode === s.code && paramsEqual(s.renderedParams, s.params)
```

`src/render/useRenderLoop.ts` (M2 does not change this file per the contracts; replace it):

```ts
import { useEffect } from 'react'
import { paramOverrides } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { DEFAULT_DEBOUNCE_MS, DEFAULT_TIMEOUT_MS, RenderController } from './controller'
import { createRenderWorker, type WorkerFactory } from './createRenderWorker'
import type { Params } from './params'
import type { RenderRequest } from './types'

/** Only parameters that differ from the source defaults become -D overrides; empty fields are omitted. */
export function buildRenderRequest(code: string, params: Params, libraries: string[]): RenderRequest {
  const overrides = paramOverrides(code, params)
  return {
    code,
    ...(Object.keys(overrides).length > 0 ? { params: overrides } : {}),
    ...(libraries.length > 0 ? { libraries } : {}),
  }
}

export function useRenderLoop(
  createWorker: WorkerFactory = createRenderWorker,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): void {
  useEffect(() => {
    const { renderStarted, renderFinished } = useAppStore.getState()
    // The store params each request was built from, so the result records exactly what it rendered.
    const paramsOf = new WeakMap<RenderRequest, Params>()
    const controller = new RenderController({
      createWorker,
      debounceMs,
      timeoutMs,
      onStart: renderStarted,
      onResult: (result, req) => renderFinished(result, req.code, paramsOf.get(req) ?? {}),
    })
    const send = (immediate: boolean) => {
      const { code, params, libraries } = useAppStore.getState()
      const req = buildRenderRequest(code, params, libraries)
      paramsOf.set(req, params)
      controller.request(req, { immediate })
    }
    send(true)
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.code !== prev.code || state.params !== prev.params) send(false)
      else if (state.libraries !== prev.libraries) send(true)
    })
    return () => {
      unsubscribe()
      controller.dispose()
    }
  }, [createWorker, debounceMs, timeoutMs])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state src/render/useRenderLoop.test.ts && npm run typecheck`
Expected: PASS (the M1/M2 store and loop tests unchanged plus 6 + 3 new), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts src/render/useRenderLoop.ts src/render/useRenderLoop.test.ts
git commit -m "feat(render): Customizer params in the store, sent as -D overrides that differ from the defaults

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pinned BOSL2 and MCAD library bundles

**Files:**
- Create: `src/render/libraries.ts`, `scripts/fetch-libraries.ts`
- Modify: `package.json`, `.gitignore`, `.github/workflows/pages.yml`
- Test: `src/render/libraries.test.ts`, `scripts/fetch-libraries.test.ts`

**Interfaces:**
- Consumes: `fflate` (`unzipSync`, `zipSync` in tests; already a dev dependency).
- Produces:
  - `src/render/libraries.ts`: `LIBRARY_NAMES = ['BOSL2', 'MCAD'] as const`; `type LibraryName`; `isLibraryName(name: string): name is LibraryName`; `LIBRARY_INFO: Record<LibraryName, { version: string; license: string; usage: string }>`; `interface LibraryBundle { name: LibraryName; version: string; source: string; files: Record<string, string> }`; `LIBRARY_ROOT = '/libraries'`; `libraryUrl(base: string, name: LibraryName): string`; `safeLibraryPath(path: string): boolean`; `writeLibraries(fs: LibraryFs, bundles: LibraryBundle[]): void` with `interface LibraryFs { mkdirTree(path: string): void; writeFile(path: string, data: string): void }`.
  - `scripts/fetch-libraries.ts`: `LIBRARY_SOURCES: Record<LibraryName, { url: string; sha256: string }>`; `verifyDownload(bytes: Uint8Array, expected: string, what: string): void`; `bundleFromZip(name: LibraryName, version: string, source: string, entries: Record<string, Uint8Array>): LibraryBundle`. CLI: `tsx scripts/fetch-libraries.ts [--if-missing]` writes `public/libraries/<name>.json`.
  - npm scripts: `fetch:libraries`; `predev`, `prebuild` and new `pretest` also fetch the pinned OpenSCAD WASM and libraries if missing (Task 5 and Task 19 render them in Node tests).

The pins, computed on 2026-10-11 (BOSL2 `v2.0.766` was released 2026-10-04; MCAD has no recent tag, so the pin is its latest commit `bd0a7ba`, 2021-10-25):

| Library | URL | SHA-256 |
| --- | --- | --- |
| BOSL2 | `https://github.com/BelfrySCAD/BOSL2/archive/refs/tags/v2.0.766.zip` | `92a9904a76021b0162976cfd8f2ae2188e792fc718762535c3c30174e61cbb97` |
| MCAD | `https://github.com/openscad/MCAD/archive/bd0a7ba3f042bfbced5ca1894b236cea08904e26.zip` | `bd40207753bb5111ac2022da47bdd0cba91393018badebc8541b8cb1d9f8572a` |

- [ ] **Step 1: Confirm the pinned hashes**

The hashes are the one value in this plan that comes from command output. Re-check them before writing them into code:

```bash
curl -sL https://github.com/BelfrySCAD/BOSL2/archive/refs/tags/v2.0.766.zip | sha256sum
curl -sL https://github.com/openscad/MCAD/archive/bd0a7ba3f042bfbced5ca1894b236cea08904e26.zip | sha256sum
```

Expected output, in order:

```
92a9904a76021b0162976cfd8f2ae2188e792fc718762535c3c30174e61cbb97  -
bd40207753bb5111ac2022da47bdd0cba91393018badebc8541b8cb1d9f8572a  -
```

If GitHub ever serves a different archive for the same ref (it has promised stable archives, but it is not guaranteed), stop: do not paste a new hash without reviewing the archive's contents, because the files run inside the app's renders.

- [ ] **Step 2: Write the failing tests**

`src/render/libraries.test.ts`:

```ts
import { isLibraryName, LIBRARY_INFO, LIBRARY_NAMES, libraryUrl, safeLibraryPath, writeLibraries, type LibraryBundle } from './libraries'

it('knows BOSL2 and MCAD and nothing else', () => {
  expect(LIBRARY_NAMES).toEqual(['BOSL2', 'MCAD'])
  expect(isLibraryName('BOSL2')).toBe(true)
  expect(isLibraryName('../etc')).toBe(false)
  expect(LIBRARY_INFO.BOSL2).toMatchObject({ version: 'v2.0.766', license: 'BSD-2-Clause', usage: 'include <BOSL2/std.scad>' })
  expect(LIBRARY_INFO.MCAD).toMatchObject({ license: 'LGPL-2.1', usage: 'use <MCAD/boxes.scad>' })
})

it('builds bundle URLs under the base path', () => {
  expect(libraryUrl('/chatscad/', 'BOSL2')).toBe('/chatscad/libraries/BOSL2.json')
})

it('accepts only relative paths without empty or parent segments', () => {
  expect(safeLibraryPath('std.scad')).toBe(true)
  expect(safeLibraryPath('bitmap/bitmap.scad')).toBe(true)
  for (const bad of ['/etc/passwd', '../x.scad', 'a/../../x', 'a//b.scad', '']) expect(safeLibraryPath(bad)).toBe(false)
})

it('writes each bundle under /libraries/<name>/, creating each directory once and skipping unsafe paths', () => {
  const dirs: string[] = []
  const files = new Map<string, string>()
  const bundle: LibraryBundle = {
    name: 'MCAD',
    version: 'x',
    source: 'https://example.test/mcad.zip',
    files: { 'boxes.scad': 'module b() {}', 'bitmap/bitmap.scad': '//', 'bitmap/x.scad': '//', '../evil.scad': 'x' },
  }
  writeLibraries({ mkdirTree: (p) => void dirs.push(p), writeFile: (p, d) => void files.set(p, d) }, [bundle])
  expect(dirs).toEqual(['/libraries/MCAD', '/libraries/MCAD/bitmap'])
  expect([...files.keys()]).toEqual(['/libraries/MCAD/boxes.scad', '/libraries/MCAD/bitmap/bitmap.scad', '/libraries/MCAD/bitmap/x.scad'])
})
```

`scripts/fetch-libraries.test.ts`:

```ts
// @vitest-environment node
import { createHash } from 'node:crypto'
import { unzipSync, zipSync } from 'fflate'
import { LIBRARY_INFO, LIBRARY_NAMES } from '../src/render/libraries'
import { bundleFromZip, LIBRARY_SOURCES, verifyDownload } from './fetch-libraries'

const enc = (s: string) => new TextEncoder().encode(s)

it('pins every library to a GitHub archive and a SHA-256, matching the version shown in the app', () => {
  for (const name of LIBRARY_NAMES) {
    const { url, sha256 } = LIBRARY_SOURCES[name]
    expect(url).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w-]+\/archive\/.+\.zip$/)
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
  }
  expect(LIBRARY_SOURCES.BOSL2.url).toContain(LIBRARY_INFO.BOSL2.version)
  expect(LIBRARY_SOURCES.MCAD.url).toContain(LIBRARY_INFO.MCAD.version)
})

it('keeps .scad and licence files, strips the archive root and skips tests, examples and docs', () => {
  const zip = zipSync({
    'BOSL2-2.0.766/std.scad': enc('include <shapes3d.scad>'),
    'BOSL2-2.0.766/shapes3d.scad': enc('module cuboid() {}'),
    'BOSL2-2.0.766/LICENSE': enc('BSD'),
    'BOSL2-2.0.766/README.md': enc('readme'),
    'BOSL2-2.0.766/tests/test_x.scad': enc('x'),
    'BOSL2-2.0.766/examples/demo.scad': enc('x'),
    'BOSL2-2.0.766/tutorials/a.scad': enc('x'),
    'BOSL2-2.0.766/scripts/a.scad': enc('x'),
  })
  const bundle = bundleFromZip('BOSL2', 'v2.0.766', 'https://x/b.zip', unzipSync(zip))
  expect(bundle).toEqual({
    name: 'BOSL2',
    version: 'v2.0.766',
    source: 'https://x/b.zip',
    files: { 'std.scad': 'include <shapes3d.scad>', 'shapes3d.scad': 'module cuboid() {}', LICENSE: 'BSD' },
  })
})

it('keeps nested library folders such as MCAD/bitmap and the LGPL text', () => {
  const entries = {
    'MCAD-bd0a/boxes.scad': enc('b'),
    'MCAD-bd0a/bitmap/bitmap.scad': enc('m'),
    'MCAD-bd0a/lgpl-2.1.txt': enc('lgpl'),
    'MCAD-bd0a/test_mcad.py': enc('py'),
  }
  expect(Object.keys(bundleFromZip('MCAD', 'bd0a7ba', 'u', entries).files).sort()).toEqual(['bitmap/bitmap.scad', 'boxes.scad', 'lgpl-2.1.txt'])
})

it('refuses an archive without .scad files', () => {
  expect(() => bundleFromZip('MCAD', 'x', 'u', { 'MCAD-x/README': enc('r') })).toThrow('MCAD: the archive has no .scad files')
})

it('verifies downloads by SHA-256 and names the library on mismatch', () => {
  const bytes = enc('zip')
  const good = createHash('sha256').update(bytes).digest('hex')
  expect(() => verifyDownload(bytes, good, 'BOSL2')).not.toThrow()
  expect(() => verifyDownload(bytes, '0'.repeat(64), 'BOSL2')).toThrow(`BOSL2 download failed verification: expected ${'0'.repeat(64)}, got ${good}`)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/render/libraries.test.ts scripts/fetch-libraries.test.ts`
Expected: FAIL with "Failed to resolve import './libraries'" and "Failed to resolve import './fetch-libraries'".

- [ ] **Step 4: Write minimal implementation**

`src/render/libraries.ts`:

```ts
export const LIBRARY_NAMES = ['BOSL2', 'MCAD'] as const
export type LibraryName = (typeof LIBRARY_NAMES)[number]

export const isLibraryName = (name: string): name is LibraryName => (LIBRARY_NAMES as readonly string[]).includes(name)

/** Shown in Settings › Libraries; `version` must match the pinned archive in scripts/fetch-libraries.ts. */
export const LIBRARY_INFO: Record<LibraryName, { version: string; license: string; usage: string }> = {
  BOSL2: { version: 'v2.0.766', license: 'BSD-2-Clause', usage: 'include <BOSL2/std.scad>' },
  MCAD: { version: 'bd0a7ba', license: 'LGPL-2.1', usage: 'use <MCAD/boxes.scad>' },
}

/** public/libraries/<name>.json, produced by scripts/fetch-libraries.ts. */
export interface LibraryBundle {
  name: LibraryName
  version: string
  /** The pinned archive URL the bundle was built from. */
  source: string
  /** Path relative to the library root → file text. */
  files: Record<string, string>
}

/** Enabled libraries live at /libraries/<name>/ in the OpenSCAD FS; OPENSCADPATH points here. */
export const LIBRARY_ROOT = '/libraries'

export const libraryUrl = (base: string, name: LibraryName) => `${base}libraries/${name}.json`

export function safeLibraryPath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

export interface LibraryFs {
  mkdirTree(path: string): void
  writeFile(path: string, data: string): void
}

export function writeLibraries(fs: LibraryFs, bundles: LibraryBundle[]): void {
  const made = new Set<string>()
  for (const bundle of bundles) {
    for (const [path, text] of Object.entries(bundle.files)) {
      if (!safeLibraryPath(path)) continue
      const full = `${LIBRARY_ROOT}/${bundle.name}/${path}`
      const dir = full.slice(0, full.lastIndexOf('/'))
      if (!made.has(dir)) {
        fs.mkdirTree(dir)
        made.add(dir)
      }
      fs.writeFile(full, text)
    }
  }
}
```

`scripts/fetch-libraries.ts`:

```ts
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { LIBRARY_INFO, LIBRARY_NAMES, type LibraryBundle, type LibraryName } from '../src/render/libraries'

const OUT_DIR = fileURLToPath(new URL('../public/libraries/', import.meta.url))

/**
 * Library code runs inside every render that enables it, so the build only accepts known archives.
 * To bump: pick the new ref, run `curl -sL <url> | sha256sum`, review the archive, update both values here
 * and LIBRARY_INFO[name].version in src/render/libraries.ts.
 */
export const LIBRARY_SOURCES: Record<LibraryName, { url: string; sha256: string }> = {
  BOSL2: {
    url: 'https://github.com/BelfrySCAD/BOSL2/archive/refs/tags/v2.0.766.zip',
    sha256: '92a9904a76021b0162976cfd8f2ae2188e792fc718762535c3c30174e61cbb97',
  },
  MCAD: {
    url: 'https://github.com/openscad/MCAD/archive/bd0a7ba3f042bfbced5ca1894b236cea08904e26.zip',
    sha256: 'bd40207753bb5111ac2022da47bdd0cba91393018badebc8541b8cb1d9f8572a',
  },
}

const SKIP_DIRS = new Set(['tests', 'examples', 'tutorials', 'scripts', 'images', 'resources', '.github'])
const LICENCE = /^(LICENSE|COPYING|lgpl[\w.-]*)(\.(txt|md))?$/i

export function verifyDownload(bytes: Uint8Array, expected: string, what: string): void {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`${what} download failed verification: expected ${expected}, got ${actual}`)
}

export function bundleFromZip(name: LibraryName, version: string, source: string, entries: Record<string, Uint8Array>): LibraryBundle {
  const decoder = new TextDecoder()
  const files: Record<string, string> = {}
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    const rel = path.split('/').slice(1).join('/')
    if (!rel || SKIP_DIRS.has(rel.split('/')[0]!)) continue
    const isLicence = !rel.includes('/') && LICENCE.test(rel)
    if (!rel.endsWith('.scad') && !isLicence) continue
    files[rel] = decoder.decode(data)
  }
  if (!Object.keys(files).some((f) => f.endsWith('.scad'))) throw new Error(`${name}: the archive has no .scad files`)
  return { name, version, source, files }
}

async function installed(name: LibraryName): Promise<string | null> {
  try {
    return (JSON.parse(await readFile(`${OUT_DIR}${name}.json`, 'utf8')) as LibraryBundle).source
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const ifMissing = process.argv.includes('--if-missing')
  await mkdir(OUT_DIR, { recursive: true })
  for (const name of LIBRARY_NAMES) {
    const { url, sha256 } = LIBRARY_SOURCES[name]
    if (ifMissing && (await installed(name)) === url) {
      console.log(`${name} already present in public/libraries/`)
      continue
    }
    console.log(`Downloading ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
    const zip = new Uint8Array(await res.arrayBuffer())
    verifyDownload(zip, sha256, name)
    const bundle = bundleFromZip(name, LIBRARY_INFO[name].version, url, unzipSync(zip))
    await writeFile(`${OUT_DIR}${name}.json`, JSON.stringify(bundle))
    console.log(`${name}: ${Object.keys(bundle.files).length} files written to public/libraries/${name}.json`)
  }
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
```

`package.json` scripts (replace the matching lines, add `fetch:libraries` and `pretest`):

```json
    "fetch:openscad": "tsx scripts/fetch-openscad.ts",
    "fetch:libraries": "tsx scripts/fetch-libraries.ts",
    "predev": "tsx scripts/fetch-openscad.ts --if-missing && tsx scripts/fetch-libraries.ts --if-missing",
    "prebuild": "tsx scripts/fetch-openscad.ts --if-missing && tsx scripts/fetch-libraries.ts --if-missing",
    "pretest": "tsx scripts/fetch-openscad.ts --if-missing && tsx scripts/fetch-libraries.ts --if-missing",
```

`.gitignore`: add a line `public/libraries/` under `public/openscad/`.

`.github/workflows/pages.yml`: after the step `- run: npm run fetch:openscad -- --if-missing`, add:

```yaml
      # The pinned BOSL2 and MCAD bundles (URLs and SHA-256 live in scripts/fetch-libraries.ts).
      - uses: actions/cache@v6
        with:
          path: public/libraries
          key: libraries-${{ hashFiles('scripts/fetch-libraries.ts') }}

      - run: npm run fetch:libraries -- --if-missing
```

- [ ] **Step 5: Run tests, then fetch for real**

Run: `npx vitest run src/render/libraries.test.ts scripts/fetch-libraries.test.ts && npm run typecheck`
Expected: PASS (4 + 5 tests), no type errors.

Run: `npm run fetch:libraries`
Expected: "BOSL2: … files written to public/libraries/BOSL2.json" and "MCAD: … files written to public/libraries/MCAD.json"; `git status` shows no file under `public/libraries/`.

- [ ] **Step 6: Commit**

```bash
git add src/render/libraries.ts src/render/libraries.test.ts scripts/fetch-libraries.ts scripts/fetch-libraries.test.ts package.json .gitignore .github/workflows/pages.yml
git commit -m "build: pinned BOSL2 and MCAD bundles fetched like the OpenSCAD WASM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Enabled libraries in the OpenSCAD file system

**Files:**
- Create: `src/test/openscadNode.ts`, `src/render/openscad.wasm.test.ts`
- Modify: `src/render/types.ts`, `src/render/runOpenSCAD.ts`, `src/render/render.worker.ts`
- Test: `src/render/runOpenSCAD.test.ts`

**Interfaces:**
- Consumes: `LibraryBundle`, `LibraryName`, `isLibraryName`, `LIBRARY_ROOT`, `writeLibraries`, `libraryUrl` (Task 4).
- Produces:
  - `RenderRequest.libraries?: string[]` (`src/render/types.ts`).
  - `OpenSCADInstance` gains `FS.mkdirTree(path: string): void` and `ENV: Record<string, string | undefined>` (both exist on the pinned Emscripten module; verified with `--version` → "OpenSCAD version 2026.10.08").
  - `type LibraryLoader = (name: LibraryName) => Promise<LibraryBundle>`; `runOpenSCAD(factory, req, loadLibrary?: LibraryLoader)`: before compiling, loads each requested library, writes it under `/libraries/<name>/`, and sets `ENV.OPENSCADPATH = '/libraries'`, so `include <BOSL2/std.scad>` resolves. OpenSCAD has no `-I` flag; `OPENSCADPATH` is its library search path, read when `callMain` starts. Unknown names and failed loads become a failed result that names the library.
  - Worker: `loadLibrary` fetches `${BASE_URL}libraries/<name>.json` once per worker and caches the promise (dropped on failure).
  - `src/test/openscadNode.ts`: `nodeOpenSCADFactory(): Promise<OpenSCADFactory>` (the real pinned WASM in Node via `wasmBinary`), `loadLibraryFromDisk(name: LibraryName): Promise<LibraryBundle>`.

- [ ] **Step 1: Write the failing tests**

In `src/render/runOpenSCAD.test.ts`, replace the `FakeInstance` type and `fakeFactory` with this version (the fake FS gains `mkdirTree` and the instance gains `ENV`), and add the import:

```ts
import type { LibraryBundle } from './libraries'

type FakeInstance = OpenSCADInstance & { files: Map<string, Uint8Array | string>; dirs: string[]; opts: OpenSCADFactoryOptions }

function fakeFactory(behaviour: (inst: FakeInstance, args: string[]) => number) {
  const created: FakeInstance[] = []
  const factory: OpenSCADFactory = async (opts) => {
    const files = new Map<string, Uint8Array | string>()
    const dirs: string[] = []
    const inst: FakeInstance = {
      files,
      dirs,
      opts,
      ENV: {},
      FS: {
        writeFile: (path, data) => void files.set(path, data),
        readFile: (path) => {
          const f = files.get(path)
          if (f === undefined) throw new Error(`ENOENT ${path}`)
          return typeof f === 'string' ? new TextEncoder().encode(f) : f
        },
        mkdirTree: (path) => void dirs.push(path),
      },
      callMain: (args) => behaviour(inst, args),
    }
    created.push(inst)
    return inst
  }
  return { factory, created }
}
```

Append to the same file:

```ts
describe('libraries', () => {
  const bosl2: LibraryBundle = { name: 'BOSL2', version: 'v', source: 'u', files: { 'std.scad': 'include <shapes3d.scad>', 'shapes3d.scad': '' } }

  it('writes enabled libraries under /libraries and points OPENSCADPATH there before compiling', async () => {
    let seenEnv: string | undefined
    const { factory, created } = fakeFactory((inst) => {
      seenEnv = inst.ENV.OPENSCADPATH
      return writesBox(inst)
    })
    const loader = vi.fn(async () => bosl2)
    const result = await runOpenSCAD(factory, { code: 'include <BOSL2/std.scad>', libraries: ['BOSL2'] }, loader)
    expect(result.ok).toBe(true)
    expect(loader).toHaveBeenCalledWith('BOSL2')
    expect(seenEnv).toBe('/libraries')
    expect(created[0]!.dirs).toEqual(['/libraries/BOSL2'])
    expect(created[0]!.files.get('/libraries/BOSL2/std.scad')).toBe('include <shapes3d.scad>')
  })

  it('leaves the file system and environment alone when no library is enabled', async () => {
    const { factory, created } = fakeFactory(writesBox)
    await runOpenSCAD(factory, { code: 'cube(1);' }, vi.fn())
    expect(created[0]!.dirs).toEqual([])
    expect(created[0]!.ENV).toEqual({})
  })

  it('fails with a plain message for an unknown library, without starting OpenSCAD', async () => {
    const { factory, created } = fakeFactory(writesBox)
    const result = await runOpenSCAD(factory, { code: 'x', libraries: ['../etc'] }, vi.fn())
    expect(result).toMatchObject({ ok: false, error: 'Unknown library "../etc"; available: BOSL2, MCAD' })
    expect(created).toHaveLength(0)
  })

  it('names the library when it cannot be loaded', async () => {
    const { factory } = fakeFactory(writesBox)
    const loader = vi.fn(async () => {
      throw new Error('GET /libraries/MCAD.json failed with 404')
    })
    expect(await runOpenSCAD(factory, { code: 'x', libraries: ['MCAD'] }, loader)).toMatchObject({
      ok: false,
      error: "Couldn't load the MCAD library: GET /libraries/MCAD.json failed with 404",
    })
  })
})
```

`src/test/openscadNode.ts`:

```ts
import { readFile } from 'node:fs/promises'
import type { LibraryBundle, LibraryName } from '../render/libraries'
import type { OpenSCADFactory, OpenSCADFactoryOptions, OpenSCADInstance } from '../render/runOpenSCAD'

const PUBLIC = new URL('../../public/', import.meta.url)

type RealFactory = (opts: OpenSCADFactoryOptions & { wasmBinary: Uint8Array }) => Promise<OpenSCADInstance>

/** The pinned OpenSCAD WASM from public/openscad/, run in Node. The web build runs there when it is handed the binary. */
export async function nodeOpenSCADFactory(): Promise<OpenSCADFactory> {
  let wasmBinary: Uint8Array
  try {
    wasmBinary = await readFile(new URL('openscad/openscad.wasm', PUBLIC))
  } catch {
    throw new Error('public/openscad/openscad.wasm is missing; run `npm run fetch:openscad`')
  }
  const mod = (await import(/* @vite-ignore */ new URL('openscad/openscad.js', PUBLIC).href)) as { default: RealFactory }
  return (opts) => mod.default({ ...opts, wasmBinary })
}

export async function loadLibraryFromDisk(name: LibraryName): Promise<LibraryBundle> {
  try {
    return JSON.parse(await readFile(new URL(`libraries/${name}.json`, PUBLIC), 'utf8')) as LibraryBundle
  } catch {
    throw new Error(`public/libraries/${name}.json is missing; run \`npm run fetch:libraries\``)
  }
}
```

`src/render/openscad.wasm.test.ts`:

```ts
// @vitest-environment node
import { loadLibraryFromDisk, nodeOpenSCADFactory } from '../test/openscadNode'
import { formatDims } from './dims'
import { runOpenSCAD, type OpenSCADFactory } from './runOpenSCAD'
import type { RenderResult } from './types'

let factory: OpenSCADFactory
beforeAll(async () => {
  factory = await nodeOpenSCADFactory()
})

const size = (r: RenderResult) => {
  if (!r.ok) throw new Error(`render failed: ${r.error}\n${r.logs.map((l) => l.text).join('\n')}`)
  return r.mesh.bounds.max.map((v, i) => v - r.mesh.bounds.min[i]!)
}

it('applies -D overrides in the real OpenSCAD WASM', async () => {
  const r = await runOpenSCAD(factory, { code: 'w = 10; // [1:50]\ncube([w, 2, 3]);', params: { w: 25 } })
  expect(r.ok && formatDims(r.mesh.bounds)).toBe('25 × 2 × 3 mm')
}, 60_000)

it('includes BOSL2 only when the library is enabled', async () => {
  const code = 'include <BOSL2/std.scad>\ncuboid([10, 20, 30], rounding = 2);'
  const withLib = await runOpenSCAD(factory, { code, libraries: ['BOSL2'] }, loadLibraryFromDisk)
  expect(size(withLib).map((v) => Math.round(v))).toEqual([10, 20, 30])
  const without = await runOpenSCAD(factory, { code }, loadLibraryFromDisk)
  expect(without).toMatchObject({ ok: false, error: 'The model produced no 3D geometry' })
}, 60_000)

it('uses MCAD modules', async () => {
  const code = 'use <MCAD/boxes.scad>\nroundedCube([10, 12, 14], 2, true, true);'
  const r = await runOpenSCAD(factory, { code, libraries: ['MCAD'] }, loadLibraryFromDisk)
  expect(size(r).map((v) => Math.round(v))).toEqual([10, 12, 14])
}, 60_000)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/runOpenSCAD.test.ts src/render/openscad.wasm.test.ts`
Expected: FAIL: the library tests fail (`seenEnv` undefined, no `/libraries` files, unknown library renders "ok"), and the BOSL2 test fails because `include <BOSL2/std.scad>` is not found. The `-D` test already passes.

- [ ] **Step 3: Write minimal implementation**

`src/render/types.ts`: replace `RenderRequest` with

```ts
export interface RenderRequest {
  code: string
  params?: Record<string, ParamValue>
  /** Enabled library names (BOSL2, MCAD), written into the FS before compiling (M3). */
  libraries?: string[]
}
```

`src/render/runOpenSCAD.ts`: replace the imports and `OpenSCADInstance`, add the loader, and change `runOpenSCAD` as shown (everything not shown stays as in M1):

```ts
import { buildArgs, INPUT_PATH, OUTPUT_PATH } from './args'
import { parseDiagnostics } from './diagnostics'
import { isLibraryName, LIBRARY_NAMES, LIBRARY_ROOT, writeLibraries, type LibraryBundle, type LibraryName } from './libraries'
import { errorMessage, failedResult } from './result'
import { parseStl } from './stl'
import type { LogLine, MeshData, RenderRequest, RenderResult } from './types'

export interface OpenSCADInstance {
  FS: {
    writeFile(path: string, data: string | Uint8Array): void
    readFile(path: string): Uint8Array
    mkdirTree(path: string): void
  }
  /** Emscripten's environment; read by OpenSCAD when callMain starts. */
  ENV: Record<string, string | undefined>
  callMain(args: string[]): number
}

export type LibraryLoader = (name: LibraryName) => Promise<LibraryBundle>

async function loadLibraries(names: string[], load: LibraryLoader | undefined): Promise<LibraryBundle[]> {
  const bundles: LibraryBundle[] = []
  for (const name of names) {
    if (!isLibraryName(name)) throw new Error(`Unknown library "${name}"; available: ${LIBRARY_NAMES.join(', ')}`)
    if (!load) throw new Error(`The ${name} library is not available in this build`)
    try {
      bundles.push(await load(name))
    } catch (e) {
      throw new Error(`Couldn't load the ${name} library: ${errorMessage(e)}`)
    }
  }
  return bundles
}

export async function runOpenSCAD(factory: OpenSCADFactory, req: RenderRequest, loadLibrary?: LibraryLoader): Promise<RenderResult> {
  const startedAt = performance.now()
  const logs: LogLine[] = []
  const fail = (error: string) => failedResult(error, { logs, renderMs: performance.now() - startedAt })

  let args: string[]
  try {
    args = buildArgs(req.params)
  } catch (e) {
    return fail(errorMessage(e))
  }

  let bundles: LibraryBundle[]
  try {
    bundles = await loadLibraries(req.libraries ?? [], loadLibrary)
  } catch (e) {
    return fail(errorMessage(e))
  }

  let instance: OpenSCADInstance
  try {
    instance = await factory({
      noInitialRun: true,
      print: (text) => logs.push({ stream: 'stdout', text }),
      printErr: (text) => logs.push({ stream: 'stderr', text }),
    })
  } catch (e) {
    return fail(`Failed to load OpenSCAD: ${errorMessage(e)}`)
  }

  instance.FS.writeFile(INPUT_PATH, req.code)
  if (bundles.length > 0) {
    writeLibraries(instance.FS, bundles)
    instance.ENV.OPENSCADPATH = LIBRARY_ROOT
  }

  // From `let exitCode: number` to the end, the function is unchanged from M1.
```

The comment on the last line marks where the existing M1 body continues verbatim (`let exitCode … return { ok: true, … }`); do not copy the comment.

`src/render/render.worker.ts`: replace the file with

```ts
import * as Comlink from 'comlink'
import { libraryUrl, type LibraryBundle, type LibraryName } from './libraries'
import { runOpenSCAD, type OpenSCADFactory, type OpenSCADFactoryOptions } from './runOpenSCAD'
import type { RenderRequest, RenderResult } from './types'

const BASE = import.meta.env.BASE_URL
const OPENSCAD_DIR = `${BASE}openscad/`

let factoryPromise: Promise<OpenSCADFactory> | null = null

function loadFactory(): Promise<OpenSCADFactory> {
  factoryPromise ??= import(/* @vite-ignore */ `${OPENSCAD_DIR}openscad.js`)
    .then((mod: { default: (opts: OpenSCADFactoryOptions) => ReturnType<OpenSCADFactory> }) => {
      const create = mod.default
      return (opts: OpenSCADFactoryOptions) => create({ ...opts, locateFile: (path) => OPENSCAD_DIR + path })
    })
    .catch((e: unknown) => {
      factoryPromise = null
      throw e
    })
  return factoryPromise
}

// One fetch per library per worker; a timeout respawns the worker and starts a fresh cache.
const libraryCache = new Map<LibraryName, Promise<LibraryBundle>>()

function loadLibrary(name: LibraryName): Promise<LibraryBundle> {
  const cached = libraryCache.get(name)
  if (cached) return cached
  const p = fetch(libraryUrl(BASE, name)).then(async (res) => {
    if (!res.ok) throw new Error(`GET ${res.url} failed with ${res.status}`)
    return (await res.json()) as LibraryBundle
  })
  libraryCache.set(name, p)
  p.catch(() => libraryCache.delete(name))
  return p
}

const api = {
  async render(req: RenderRequest): Promise<RenderResult> {
    const result = await runOpenSCAD(await loadFactory(), req, loadLibrary)
    if (!result.ok) return result
    return Comlink.transfer(result, [result.mesh.positions.buffer, result.mesh.normals.buffer, result.stl])
  },
}

export type RenderWorkerApi = typeof api

Comlink.expose(api)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render && npm run typecheck`
Expected: PASS (all render tests, including 4 new library tests and 3 real-WASM tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/types.ts src/render/runOpenSCAD.ts src/render/runOpenSCAD.test.ts src/render/render.worker.ts src/render/openscad.wasm.test.ts src/test/openscadNode.ts
git commit -m "feat(render): write enabled BOSL2 and MCAD into the worker FS with OPENSCADPATH

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dexie schema v2, repositories and the settings store

**Files:**
- Modify: `src/db/db.ts`, `src/db/settings.ts` (only if M2's names differ), `package.json` (verify `dexie` and `fake-indexeddb` from M2)
- Create: `src/db/projects.ts`, `src/db/messages.ts`, `src/db/presets.ts`, `src/db/blobs.ts`, `src/settings/settingsStore.ts`, `src/test/resetDb.ts`, `src/test/fixtures.ts`
- Test: `src/db/db.test.ts`, `src/db/repos.test.ts`, `src/settings/settingsStore.test.ts`

**Interfaces:**
- Consumes: M2 `src/db/db.ts` (v1 stores, `ProviderProfile`, `UsageRecord`, `Settings`, `DEFAULT_SETTINGS`, `ChatScadDb`, `db`); M2 `src/db/settings.ts`; `ParamValue` (M1).
- Produces:
  - `src/db/db.ts` (contract): `VersionSource`, `Project`, `Version`, `StoredMessage`, `Preset`, `StoredBlob` exactly as the design doc; `PrinterProfile { id: string }` (reserved); `Settings` gains `theme: ThemeSetting`, `debounceMs`, `timeoutMs`, `lastProjectId`, `lockMode`, and (see "Contract issues") `lockSalt: string | null`, `lockVerifier: string | null`; `type ThemeSetting = 'system' | 'dark' | 'light'`; `V1_STORES`, `V2_STORES`; `fillSettingsDefaults(row: Record<string, unknown>): void`; `ChatScadDb` declares `version(2)` with the new tables, an extra `versionId` index on `usage`, and an upgrade that fills the new settings fields.
  - `src/db/settings.ts` (M2 repository; M3 relies on): `getSettings(): Promise<Settings>` (row merged over `DEFAULT_SETTINGS`), `updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings>`.
  - `src/db/projects.ts`: `putProject(p: Project): Promise<void>`, `getProject(id: string): Promise<Project | undefined>`, `listRecentProjects(limit?: number): Promise<Project[]>` (newest `updatedAt` first, default 8), `listAllProjects(): Promise<Project[]>`, `deleteProjectCascade(id: string): Promise<void>` (project, versions, messages, presets, and their thumbnail and image blobs).
  - `src/db/messages.ts`: `putMessage(m: StoredMessage): Promise<void>`, `listMessages(projectId: string): Promise<StoredMessage[]>` (by `createdAt`), `messagesForVersion(versionId: string): Promise<StoredMessage[]>`.
  - `src/db/presets.ts`: `listPresets(projectId: string): Promise<Preset[]>` (by name), `putPreset(p: Preset): Promise<void>`, `deletePreset(id: string): Promise<void>`.
  - `src/db/blobs.ts`: `putBlob(kind: StoredBlob['kind'], data: Blob): Promise<string>`, `getBlob(id: string): Promise<StoredBlob | undefined>`.
  - `src/settings/settingsStore.ts`: `useSettingsStore` with `{ settings: Settings; loaded: boolean; load(): Promise<void>; update(patch: Partial<Omit<Settings, 'id'>>): Promise<void> }`.
  - `src/test/resetDb.ts`: `resetDb(): Promise<void>`. `src/test/fixtures.ts`: `makeVersion(over)`, `makeProject(over)`.

Tests that use IndexedDB run in the Node environment with `fake-indexeddb/auto` (Node's `structuredClone` can store `Blob`s; jsdom's `Blob` cannot be cloned by it).

- [ ] **Step 1: Write the failing tests**

`src/db/db.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import type { ProviderProfile, UsageRecord } from './db'
import { DEFAULT_SETTINGS, ChatScadDb, V1_STORES } from './db'

const profile: ProviderProfile = {
  id: 'p1',
  name: 'OpenRouter',
  adapter: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-test',
  defaultModel: 'openai/gpt-5-mini',
  cachedModels: [{ id: 'openai/gpt-5-mini' }],
  capabilities: { streaming: true, vision: false, audio: false },
  priceTable: {},
  createdAt: 1,
  updatedAt: 2,
}

const usage: UsageRecord = {
  id: 'u1',
  profileId: 'p1',
  model: 'openai/gpt-5-mini',
  inputTokens: 1000,
  outputTokens: 180,
  cost: 0.006,
  costSource: 'provider',
  createdAt: 3,
  projectId: null,
  versionId: null,
}

it('upgrades a version 1 database to version 2 without losing profiles, usage or settings', async () => {
  const name = `upgrade-${crypto.randomUUID()}`
  const v1 = new Dexie(name)
  v1.version(1).stores(V1_STORES)
  await v1.open()
  await v1.table('providerProfiles').add(profile)
  await v1.table('usage').add(usage)
  await v1.table('settings').add({ id: 'app', activeProfileId: 'p1', activeModel: 'openai/gpt-5-mini', autoFixAttempts: 3 })
  v1.close()

  const v2 = new ChatScadDb(name)
  await v2.open()
  expect(v2.verno).toBe(2)
  expect(await v2.providerProfiles.get('p1')).toEqual(profile)
  expect(await v2.usage.toArray()).toEqual([usage])
  expect(await v2.settings.get('app')).toEqual({
    ...DEFAULT_SETTINGS,
    activeProfileId: 'p1',
    activeModel: 'openai/gpt-5-mini',
    autoFixAttempts: 3,
  })
  expect(v2.tables.map((t) => t.name).sort()).toEqual([
    'blobs', 'messages', 'presets', 'printerProfiles', 'projects', 'providerProfiles', 'settings', 'usage', 'versions',
  ])
  expect(await v2.usage.where('versionId').equals('nope').count()).toBe(0)
  v2.close()
  await Dexie.delete(name)
})

it('creates a fresh database at version 2 with M3 settings defaults', () => {
  expect(DEFAULT_SETTINGS).toEqual({
    id: 'app',
    activeProfileId: null,
    activeModel: null,
    autoFixAttempts: 2,
    theme: 'system',
    debounceMs: 600,
    timeoutMs: 60_000,
    lastProjectId: null,
    lockMode: false,
    lockSalt: null,
    lockVerifier: null,
  })
})
```

`src/db/repos.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { makeProject, makeVersion } from '../test/fixtures'
import { resetDb } from '../test/resetDb'
import { getBlob, putBlob } from './blobs'
import { db, type StoredMessage } from './db'
import { listMessages, messagesForVersion, putMessage } from './messages'
import { deletePreset, listPresets, putPreset } from './presets'
import { deleteProjectCascade, getProject, listAllProjects, listRecentProjects, putProject } from './projects'

beforeEach(resetDb)

const message = (over: Partial<StoredMessage>): StoredMessage => ({
  id: crypto.randomUUID(),
  projectId: 'p1',
  versionId: null,
  role: 'user',
  content: 'hi',
  imageBlobIds: [],
  audioTranscript: null,
  model: null,
  usageId: null,
  createdAt: 1,
  ...over,
})

it('lists projects newest first and limits the recent list', async () => {
  for (let i = 1; i <= 10; i++) await putProject(makeProject({ id: `p${i}`, name: `P${i}`, updatedAt: i }))
  expect((await listRecentProjects()).map((p) => p.id)).toEqual(['p10', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3'])
  expect(await listRecentProjects(2)).toHaveLength(2)
  expect(await listAllProjects()).toHaveLength(10)
  expect((await getProject('p4'))?.name).toBe('P4')
})

it('deletes a project with its versions, messages, presets and blobs, and nothing else', async () => {
  const thumb = await putBlob('thumbnail', new Blob(['png'], { type: 'image/png' }))
  const image = await putBlob('image', new Blob(['jpg'], { type: 'image/jpeg' }))
  const other = await putBlob('thumbnail', new Blob(['keep']))
  await putProject(makeProject({ id: 'p1' }))
  await putProject(makeProject({ id: 'p2' }))
  await db.versions.bulkAdd([
    makeVersion({ id: 'v1', projectId: 'p1', thumbnailBlobId: thumb }),
    makeVersion({ id: 'w1', projectId: 'p2', thumbnailBlobId: other }),
  ])
  await putMessage(message({ projectId: 'p1', imageBlobIds: [image] }))
  await putMessage(message({ projectId: 'p2' }))
  await putPreset({ id: 's1', projectId: 'p1', name: 'big', params: { w: 1 } })

  await deleteProjectCascade('p1')

  expect(await getProject('p1')).toBeUndefined()
  expect(await db.versions.toArray()).toEqual([expect.objectContaining({ id: 'w1' })])
  expect(await db.messages.count()).toBe(1)
  expect(await listPresets('p1')).toEqual([])
  expect(await getBlob(thumb)).toBeUndefined()
  expect(await getBlob(image)).toBeUndefined()
  expect(await getBlob(other)).toBeDefined()
})

it('lists messages by time, per project and per version', async () => {
  await putMessage(message({ id: 'b', createdAt: 2, versionId: 'v1' }))
  await putMessage(message({ id: 'a', createdAt: 1, versionId: 'v1' }))
  await putMessage(message({ id: 'c', createdAt: 3, projectId: 'p2' }))
  expect((await listMessages('p1')).map((m) => m.id)).toEqual(['a', 'b'])
  expect((await messagesForVersion('v1')).map((m) => m.id)).toEqual(['a', 'b'])
})

it('stores presets by name and deletes them', async () => {
  await putPreset({ id: 's2', projectId: 'p1', name: 'tall', params: { h: 40 } })
  await putPreset({ id: 's1', projectId: 'p1', name: 'big', params: { w: 1 } })
  expect((await listPresets('p1')).map((p) => p.name)).toEqual(['big', 'tall'])
  await deletePreset('s1')
  expect((await listPresets('p1')).map((p) => p.id)).toEqual(['s2'])
})

it('stores blobs and reads them back', async () => {
  const id = await putBlob('thumbnail', new Blob(['abc'], { type: 'image/png' }))
  const stored = await getBlob(id)
  expect(stored?.kind).toBe('thumbnail')
  expect(await stored?.data.text()).toBe('abc')
})
```

`src/settings/settingsStore.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { db, DEFAULT_SETTINGS } from '../db/db'
import { resetDb } from '../test/resetDb'
import { useSettingsStore } from './settingsStore'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

it('starts with the defaults, loads the stored row, and persists updates', async () => {
  expect(useSettingsStore.getState()).toMatchObject({ settings: DEFAULT_SETTINGS, loaded: false })
  await db.settings.put({ ...DEFAULT_SETTINGS, debounceMs: 900 })
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState()).toMatchObject({ loaded: true, settings: { debounceMs: 900 } })

  await useSettingsStore.getState().update({ theme: 'light', timeoutMs: 30_000 })
  expect(useSettingsStore.getState().settings).toMatchObject({ theme: 'light', timeoutMs: 30_000, debounceMs: 900 })
  expect(await db.settings.get('app')).toMatchObject({ theme: 'light', timeoutMs: 30_000 })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db src/settings`
Expected: FAIL: `V1_STORES` is not exported, `DEFAULT_SETTINGS` lacks the M3 fields, and the new modules do not resolve.

- [ ] **Step 3: Write minimal implementation**

`package.json`: confirm M2 added `dexie` (dependency) and `fake-indexeddb` (dev dependency). If either is missing, run `npm install dexie@^4.4.6` and `npm install -D fake-indexeddb@^6.2.5`.

`src/db/db.ts` (replace; the M2 interfaces are copied from the contract unchanged, M3's are added; if M2 kept other exports in this file, keep them):

```ts
import Dexie, { type Table } from 'dexie'
import type { AdapterKind, ModelInfo, ModelPrice, ProviderCapabilities } from '../ai/types'
import type { ParamValue } from '../render/types'

export interface ProviderProfile {
  id: string
  name: string
  adapter: AdapterKind
  baseUrl: string
  apiKey: string // M3 lock mode stores ciphertext here and sets keyEncrypted
  keyEncrypted?: boolean // M3
  defaultModel: string
  cachedModels: ModelInfo[]
  capabilities: ProviderCapabilities
  priceTable: Record<string, ModelPrice> // model id → price, user-editable
  createdAt: number
  updatedAt: number
}

export interface UsageRecord {
  id: string
  profileId: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number | null
  costSource: 'provider' | 'price-table' | null
  createdAt: number
  projectId: string | null // null in M2; set from M3
  versionId: string | null // null in M2; set from M3
}

export type ThemeSetting = 'system' | 'dark' | 'light'

export interface Settings {
  id: 'app'
  activeProfileId: string | null
  activeModel: string | null
  autoFixAttempts: number // default 2
  // M3
  theme: ThemeSetting
  debounceMs: number
  timeoutMs: number
  lastProjectId: string | null
  lockMode: boolean
  /** Base64 of the random 16-byte PBKDF2 salt while lock mode is on. */
  lockSalt: string | null
  /** Base64 AES-GCM ciphertext of a fixed text; decrypting it checks the passphrase. */
  lockVerifier: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  activeProfileId: null,
  activeModel: null,
  autoFixAttempts: 2,
  theme: 'system',
  debounceMs: 600,
  timeoutMs: 60_000,
  lastProjectId: null,
  lockMode: false,
  lockSalt: null,
  lockVerifier: null,
}

export type VersionSource = 'ai' | 'manual' | 'slider' | 'autofix' | 'restore' | 'gallery' | 'import'

export interface Project {
  id: string; name: string; createdAt: number; updatedAt: number
  headVersionId: string | null
  providerProfileId: string | null
  enabledLibraries: string[] // 'BOSL2' | 'MCAD'
  origin: 'blank' | 'gallery' | 'shared-link'
}

export interface Version {
  id: string; projectId: string; parentId: string | null
  code: string
  params: Record<string, ParamValue>
  source: VersionSource
  kind: 'main' | 'variant'
  variantGroupId: string | null
  label: string // "v3", "v3.1" — computed on create, stable afterwards
  message: string // prompt, "height 18 → 22", "Auto-fix: …"
  model: string | null
  compileStatus: 'ok' | 'error' | 'pending'
  renderMs: number | null
  thumbnailBlobId: string | null
  createdAt: number
}

export interface StoredMessage {
  id: string; projectId: string; versionId: string | null
  role: 'user' | 'assistant' | 'note'
  content: string
  imageBlobIds: string[] // used from M5
  audioTranscript: string | null // used from M4
  model: string | null
  usageId: string | null
  createdAt: number
}

export interface Preset { id: string; projectId: string; name: string; params: Record<string, ParamValue> }
export interface StoredBlob { id: string; kind: 'thumbnail' | 'image' | 'stl'; data: Blob }
/** Reserved for future printing features (spec "Future: 3D printing hooks"). */
export interface PrinterProfile { id: string }

export const V1_STORES = { providerProfiles: 'id, name', usage: 'id, profileId, createdAt, projectId', settings: 'id' }
export const V2_STORES = {
  usage: 'id, profileId, createdAt, projectId, versionId',
  projects: 'id, updatedAt',
  versions: 'id, projectId, parentId, createdAt',
  messages: 'id, projectId, versionId, createdAt',
  presets: 'id, projectId',
  blobs: 'id',
  printerProfiles: 'id',
}

/** Adds any settings field the row lacks, from DEFAULT_SETTINGS. Used by the v2 upgrade. */
export function fillSettingsDefaults(row: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) if (!(key in row)) row[key] = value
}

export class ChatScadDb extends Dexie {
  providerProfiles!: Table<ProviderProfile, string>
  usage!: Table<UsageRecord, string>
  settings!: Table<Settings, 'app'>
  projects!: Table<Project, string>
  versions!: Table<Version, string>
  messages!: Table<StoredMessage, string>
  presets!: Table<Preset, string>
  blobs!: Table<StoredBlob, string>
  printerProfiles!: Table<PrinterProfile, string>

  constructor(name = 'chatscad') {
    super(name)
    this.version(1).stores(V1_STORES)
    this.version(2)
      .stores(V2_STORES)
      .upgrade((tx) =>
        tx
          .table('settings')
          .toCollection()
          .modify((row: Record<string, unknown>) => fillSettingsDefaults(row)),
      )
  }
}

/** Database name 'chatscad'. Tests use `fake-indexeddb` and `new ChatScadDb(uniqueName)` or `resetDb()`. */
export const db = new ChatScadDb()
```

`src/db/settings.ts`: M3 relies on these two functions. If M2's file already exports them with these signatures, leave it; otherwise add them (keeping M2's own exports):

```ts
import { db, DEFAULT_SETTINGS, type Settings } from './db'

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get('app')) ?? {}) }
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const next: Settings = { ...(await getSettings()), ...patch, id: 'app' }
  await db.settings.put(next)
  return next
}
```

`src/db/projects.ts`:

```ts
import { db, type Project } from './db'

export async function putProject(p: Project): Promise<void> {
  await db.projects.put(p)
}

export const getProject = (id: string): Promise<Project | undefined> => db.projects.get(id)

export const listRecentProjects = (limit = 8): Promise<Project[]> => db.projects.orderBy('updatedAt').reverse().limit(limit).toArray()

export const listAllProjects = (): Promise<Project[]> => db.projects.orderBy('updatedAt').reverse().toArray()

export async function deleteProjectCascade(id: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.versions, db.messages, db.presets, db.blobs], async () => {
    const versions = await db.versions.where('projectId').equals(id).toArray()
    const messages = await db.messages.where('projectId').equals(id).toArray()
    const blobIds = [
      ...versions.flatMap((v) => (v.thumbnailBlobId ? [v.thumbnailBlobId] : [])),
      ...messages.flatMap((m) => m.imageBlobIds),
    ]
    await db.blobs.bulkDelete(blobIds)
    await db.versions.where('projectId').equals(id).delete()
    await db.messages.where('projectId').equals(id).delete()
    await db.presets.where('projectId').equals(id).delete()
    await db.projects.delete(id)
  })
}
```

`src/db/messages.ts`:

```ts
import { db, type StoredMessage } from './db'

export async function putMessage(m: StoredMessage): Promise<void> {
  await db.messages.put(m)
}

export const listMessages = (projectId: string): Promise<StoredMessage[]> =>
  db.messages.where('projectId').equals(projectId).sortBy('createdAt')

export const messagesForVersion = (versionId: string): Promise<StoredMessage[]> =>
  db.messages.where('versionId').equals(versionId).sortBy('createdAt')
```

`src/db/presets.ts`:

```ts
import { db, type Preset } from './db'

export const listPresets = (projectId: string): Promise<Preset[]> => db.presets.where('projectId').equals(projectId).sortBy('name')

export async function putPreset(p: Preset): Promise<void> {
  await db.presets.put(p)
}

export async function deletePreset(id: string): Promise<void> {
  await db.presets.delete(id)
}
```

`src/db/blobs.ts`:

```ts
import { db, type StoredBlob } from './db'

export async function putBlob(kind: StoredBlob['kind'], data: Blob): Promise<string> {
  const id = crypto.randomUUID()
  await db.blobs.add({ id, kind, data })
  return id
}

export const getBlob = (id: string): Promise<StoredBlob | undefined> => db.blobs.get(id)
```

`src/settings/settingsStore.ts`:

```ts
import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '../db/db'
import { getSettings, updateSettings } from '../db/settings'

export interface SettingsState {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Omit<Settings, 'id'>>): Promise<void>
}

/** In-memory mirror of the settings row, so components and the render loop can subscribe to it. */
export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => set({ settings: await getSettings(), loaded: true }),
  update: async (patch) => set({ settings: await updateSettings(patch) }),
}))
```

`src/test/resetDb.ts`:

```ts
import { db } from '../db/db'

/** Wipes the Dexie singleton and reopens it empty at the current schema version. */
export async function resetDb(): Promise<void> {
  await db.delete()
  await db.open()
}
```

`src/test/fixtures.ts`:

```ts
import type { Project, Version } from '../db/db'

export function makeVersion(over: Partial<Version> & Pick<Version, 'id'>): Version {
  return {
    projectId: 'p1',
    parentId: null,
    code: 'cube(1);',
    params: {},
    source: 'manual',
    kind: 'main',
    variantGroupId: null,
    label: 'v1',
    message: '',
    model: null,
    compileStatus: 'ok',
    renderMs: 10,
    thumbnailBlobId: null,
    createdAt: 1,
    ...over,
  }
}

export function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Holder',
    createdAt: 1,
    updatedAt: 1,
    headVersionId: null,
    providerProfileId: null,
    enabledLibraries: [],
    origin: 'blank',
    ...over,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db src/settings && npm run typecheck`
Expected: PASS (2 + 5 + 1 new tests, and M2's db tests), no type errors. If M2's own tests built `Settings` literals, they now need the M3 fields: spread `DEFAULT_SETTINGS` into them.

- [ ] **Step 5: Commit**

```bash
git add src/db src/settings/settingsStore.ts src/settings/settingsStore.test.ts src/test/resetDb.ts src/test/fixtures.ts package.json package-lock.json
git commit -m "feat(db): schema v2 with projects, versions, messages, presets and blobs, keeping M2 data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Versions API and labels

**Files:**
- Create: `src/history/versions.ts`
- Test: `src/history/versions.test.ts`

**Interfaces:**
- Consumes: `db`, `Version` (Task 6); `resetDb`, `makeVersion` (Task 6).
- Produces (contract, `src/history/versions.ts`):
  - `nextLabel(parent: Version | null, siblings: Version[]): string`: no parent → `v1`; first child (no siblings) → the parent's last number plus one (`v3` → `v4`, `v3.1` → `v3.2`); otherwise `${parent.label}.${siblings.length}` (`v3` with one child → `v3.1`, with two → `v3.2`).
  - `createVersion(input: Omit<Version, 'id' | 'label' | 'createdAt'>): Promise<Version>`: in one transaction, finds the parent and its siblings, takes `nextLabel`, and if that label is already used in the project falls back to `${parent.label}.${k}` with the smallest free `k ≥ max(1, siblings.length)`. Labels are unique per project and never change. `createdAt` is `Date.now()`, bumped by 1 ms when needed so it strictly increases within the session.
  - `listVersions(projectId: string): Promise<Version[]>` (oldest first), `ancestry(versionId: string): Promise<Version[]>` (head first, stops at a missing parent or a loop).
  - Extra: `getVersion(id: string): Promise<Version | undefined>`; `type VersionPatch = Partial<Pick<Version, 'compileStatus' | 'renderMs' | 'thumbnailBlobId'>>`; `updateVersion(id: string, patch: VersionPatch): Promise<void>`. Code, params, label and parent are never patched.

- [ ] **Step 1: Write the failing test**

`src/history/versions.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { db, type Version } from '../db/db'
import { makeVersion } from '../test/fixtures'
import { resetDb } from '../test/resetDb'
import { ancestry, createVersion, getVersion, listVersions, nextLabel, updateVersion } from './versions'

beforeEach(resetDb)

const v = (label: string) => makeVersion({ id: label, label })

const input = (parentId: string | null, over: Partial<Version> = {}): Omit<Version, 'id' | 'label' | 'createdAt'> => ({
  projectId: 'p1',
  parentId,
  code: 'cube(1);',
  params: {},
  source: 'manual',
  kind: 'main',
  variantGroupId: null,
  message: '',
  model: null,
  compileStatus: 'ok',
  renderMs: 5,
  thumbnailBlobId: null,
  ...over,
})

async function chain(n: number): Promise<Version[]> {
  const out: Version[] = []
  for (let i = 0; i < n; i++) out.push(await createVersion(input(out.at(-1)?.id ?? null)))
  return out
}

describe('nextLabel', () => {
  it('numbers the main line and branches', () => {
    expect(nextLabel(null, [])).toBe('v1')
    expect(nextLabel(v('v3'), [])).toBe('v4')
    expect(nextLabel(v('v3'), [v('v4')])).toBe('v3.1')
    expect(nextLabel(v('v3'), [v('v4'), v('v3.1')])).toBe('v3.2')
    expect(nextLabel(v('v3.1'), [])).toBe('v3.2')
    expect(nextLabel(v('v3.1'), [v('v3.2')])).toBe('v3.1.1')
  })
})

describe('createVersion', () => {
  it('builds the main line v1, v2, v3 with ids and strictly increasing times', async () => {
    const [a, b, c] = await chain(3)
    expect([a!.label, b!.label, c!.label]).toEqual(['v1', 'v2', 'v3'])
    expect(new Set([a!.id, b!.id, c!.id]).size).toBe(3)
    expect(a!.createdAt).toBeLessThan(b!.createdAt)
    expect(b!.createdAt).toBeLessThan(c!.createdAt)
    expect(await db.versions.count()).toBe(3)
  })

  it('labels branches v3.1, v3.2 and moves a clashing continuation to v3.1.1', async () => {
    const [, , v3] = await chain(4)
    const b1 = await createVersion(input(v3!.id))
    const b2 = await createVersion(input(v3!.id))
    const b1child = await createVersion(input(b1.id))
    expect([b1.label, b2.label, b1child.label]).toEqual(['v3.1', 'v3.2', 'v3.1.1'])
  })

  it('moves a second branch past a label its sibling branch already took', async () => {
    const [, , v3] = await chain(4)
    const b1 = await createVersion(input(v3!.id))
    const b1child = await createVersion(input(b1.id))
    const b2 = await createVersion(input(v3!.id))
    expect([b1.label, b1child.label, b2.label]).toEqual(['v3.1', 'v3.2', 'v3.3'])
    const labels = (await listVersions('p1')).map((x) => x.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('refuses a parent that is not in the project', async () => {
    const [a] = await chain(1)
    await expect(createVersion(input(a!.id, { projectId: 'p2' }))).rejects.toThrow(`Parent version ${a!.id} is not in project p2`)
  })
})

it('lists a project oldest first, walks the ancestry head first, and patches status fields', async () => {
  const [a, b, c] = await chain(3)
  await createVersion(input(null, { projectId: 'p2' }))
  expect((await listVersions('p1')).map((x) => x.label)).toEqual(['v1', 'v2', 'v3'])
  expect((await ancestry(c!.id)).map((x) => x.id)).toEqual([c!.id, b!.id, a!.id])
  expect(await ancestry('missing')).toEqual([])

  await updateVersion(b!.id, { compileStatus: 'error', renderMs: 42, thumbnailBlobId: 't1' })
  expect(await getVersion(b!.id)).toMatchObject({ compileStatus: 'error', renderMs: 42, thumbnailBlobId: 't1', label: 'v2' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/history/versions.test.ts`
Expected: FAIL with "Failed to resolve import './versions'".

- [ ] **Step 3: Write minimal implementation**

`src/history/versions.ts`:

```ts
import { db, type Version } from '../db/db'

export type VersionPatch = Partial<Pick<Version, 'compileStatus' | 'renderMs' | 'thumbnailBlobId'>>

let lastCreatedAt = 0
/** Date.now(), strictly increasing within the session so versions made in the same millisecond stay ordered. */
function now(): number {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1)
  return lastCreatedAt
}

function bump(label: string): string {
  const parts = label.slice(1).split('.')
  parts[parts.length - 1] = String(Number(parts.at(-1)) + 1)
  return `v${parts.join('.')}`
}

/** "v4" after "v3"; "v3.1" for a second child of v3; "v3.2" after "v3.1". */
export function nextLabel(parent: Version | null, siblings: Version[]): string {
  if (!parent) return 'v1'
  if (siblings.length === 0) return bump(parent.label)
  return `${parent.label}.${siblings.length}`
}

function uniqueLabel(candidate: string, parent: Version | null, siblings: Version[], taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate
  const base = parent?.label ?? 'v1'
  for (let k = Math.max(1, siblings.length); ; k++) {
    const label = `${base}.${k}`
    if (!taken.has(label)) return label
  }
}

export async function createVersion(input: Omit<Version, 'id' | 'label' | 'createdAt'>): Promise<Version> {
  return db.transaction('rw', db.versions, async () => {
    const all = await db.versions.where('projectId').equals(input.projectId).toArray()
    const parent = input.parentId === null ? null : (all.find((v) => v.id === input.parentId) ?? null)
    if (input.parentId !== null && !parent) throw new Error(`Parent version ${input.parentId} is not in project ${input.projectId}`)
    const siblings = all.filter((v) => v.parentId === input.parentId)
    const label = uniqueLabel(nextLabel(parent, siblings), parent, siblings, new Set(all.map((v) => v.label)))
    const version: Version = { ...input, id: crypto.randomUUID(), label, createdAt: now() }
    await db.versions.add(version)
    return version
  })
}

export const getVersion = (id: string): Promise<Version | undefined> => db.versions.get(id)

export const listVersions = (projectId: string): Promise<Version[]> => db.versions.where('projectId').equals(projectId).sortBy('createdAt')

/** The version and its parents, head first. */
export async function ancestry(versionId: string): Promise<Version[]> {
  const out: Version[] = []
  const seen = new Set<string>()
  let id: string | null = versionId
  while (id !== null && !seen.has(id)) {
    seen.add(id)
    const v: Version | undefined = await db.versions.get(id)
    if (!v) break
    out.push(v)
    id = v.parentId
  }
  return out
}

export async function updateVersion(id: string, patch: VersionPatch): Promise<void> {
  await db.versions.update(id, patch)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/history/versions.test.ts && npm run typecheck`
Expected: PASS (6 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/history/versions.ts src/history/versions.test.ts
git commit -m "feat(history): versions API with stable v3 / v3.1 labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Side-by-side diff and version messages

**Files:**
- Create: `src/history/diff.ts`, `src/history/messages.ts`
- Modify: `package.json` (add `diff`)
- Test: `src/history/diff.test.ts`

**Interfaces:**
- Consumes: `diffLines` from `diff` 9.0.0 (ESM export, bundled types; returns change objects `{ value, added, removed, count }` in order, removals before the matching additions; option `ignoreNewlineAtEof`). `paramValueEqual`, `Params` (Task 2).
- Produces:
  - `src/history/diff.ts`: `interface DiffCell { line: number; text: string; kind: 'same' | 'add' | 'del' }`; `type DiffRow = { kind: 'pair'; left: DiffCell | null; right: DiffCell | null } | { kind: 'skip'; count: number }`; `interface SideBySide { rows: DiffRow[]; added: number; removed: number }`; `sideBySide(oldCode: string, newCode: string, context = 3): SideBySide` (removed and added runs are paired line by line; unchanged runs longer than the context on both sides collapse into one `skip` row); `countLineChanges(oldCode: string, newCode: string): { added: number; removed: number }`.
  - `src/history/messages.ts`: `truncate(text: string, max = 120): string` (first line, `…` when cut); `formatValue(v: ParamValue): string`; `describeParamChanges(before: Params, after: Params): string` ("height 18 → 22", up to three, then "and N more"; "Parameters unchanged" when equal); `manualMessage(oldCode: string, newCode: string): string` ("Edited code · +2 −1 lines"); `bakeMessage(names: string[]): string` ("Baked height, wall into code").

- [ ] **Step 1: Add the dependency and write the failing test**

Run: `npm install diff@^9.0.0`
Expected: `package.json` lists `"diff": "^9.0.0"` under dependencies. No `@types/diff` is needed: 9.x ships `libesm/index.d.ts`.

`src/history/diff.test.ts`:

```ts
import { countLineChanges, sideBySide, type DiffRow } from './diff'
import { bakeMessage, describeParamChanges, formatValue, manualMessage, truncate } from './messages'

const lines = (n: number, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join('\n') + '\n'

const show = (rows: DiffRow[]) =>
  rows.map((r) =>
    r.kind === 'skip'
      ? `skip ${r.count}`
      : `${r.left ? `${r.left.kind}:${r.left.line}:${r.left.text}` : '-'} | ${r.right ? `${r.right.kind}:${r.right.line}:${r.right.text}` : '-'}`,
  )

describe('sideBySide', () => {
  it('pairs removed and added lines and counts them', () => {
    const { rows, added, removed } = sideBySide('a\nb\nc\nd\n', 'a\nB\nc\nd\nE\n')
    expect(show(rows)).toEqual([
      'same:1:a | same:1:a',
      'del:2:b | add:2:B',
      'same:3:c | same:3:c',
      'same:4:d | same:4:d',
      '- | add:5:E',
    ])
    expect({ added, removed }).toEqual({ added: 2, removed: 1 })
  })

  it('pads an uneven change with empty cells on the shorter side', () => {
    expect(show(sideBySide('x\ny\nz\n', 'x\nY\n').rows)).toEqual(['same:1:x | same:1:x', 'del:2:y | add:2:Y', 'del:3:z | -'])
  })

  it('collapses long unchanged runs, keeping three lines of context around each change', () => {
    const oldCode = lines(20)
    const newCode = oldCode.replace('l10\n', 'ten\n')
    const out = show(sideBySide(oldCode, newCode).rows)
    expect(out).toEqual([
      'skip 6',
      'same:7:l7 | same:7:l7',
      'same:8:l8 | same:8:l8',
      'same:9:l9 | same:9:l9',
      'del:10:l10 | add:10:ten',
      'same:11:l11 | same:11:l11',
      'same:12:l12 | same:12:l12',
      'same:13:l13 | same:13:l13',
      'skip 7',
    ])
  })

  it('shows identical code as one collapsed run', () => {
    expect(sideBySide(lines(5), lines(5))).toEqual({ rows: [{ kind: 'skip', count: 5 }], added: 0, removed: 0 })
  })

  it('ignores a missing newline at the end of the file', () => {
    expect(countLineChanges('a\nb', 'a\nb\n')).toEqual({ added: 0, removed: 0 })
    expect(countLineChanges('a\nb\n', 'a\nc\nd\n')).toEqual({ added: 2, removed: 1 })
  })
})

describe('version messages', () => {
  it('describes parameter changes with arrows, up to three', () => {
    expect(describeParamChanges({ height: 18, wall: 2 }, { height: 22, wall: 2 })).toBe('height 18 → 22')
    expect(describeParamChanges({ a: 1, b: 'x', c: true, d: [1, 2] }, { a: 2, b: 'y', c: false, d: [1, 3] })).toBe(
      'a 1 → 2, b x → y, c true → false and 1 more',
    )
    expect(describeParamChanges({ a: 1 }, { a: 1 })).toBe('Parameters unchanged')
    expect(describeParamChanges({}, { size: [1, 2] })).toBe('size [1, 2]')
  })

  it('summarises manual edits, bakes, and long text', () => {
    expect(manualMessage('a\nb\n', 'a\nc\nd\n')).toBe('Edited code · +2 −1 lines')
    expect(bakeMessage(['height', 'wall'])).toBe('Baked height, wall into code')
    expect(bakeMessage([])).toBe('Baked parameters into code')
    expect(truncate('  first line\nsecond')).toBe('first line')
    expect(truncate('x'.repeat(130))).toBe(`${'x'.repeat(119)}…`)
    expect(formatValue([1, 2.5])).toBe('[1, 2.5]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/history/diff.test.ts`
Expected: FAIL with "Failed to resolve import './diff'".

- [ ] **Step 3: Write minimal implementation**

`src/history/diff.ts`:

```ts
import { diffLines } from 'diff'

export interface DiffCell {
  line: number
  text: string
  kind: 'same' | 'add' | 'del'
}

export type DiffRow = { kind: 'pair'; left: DiffCell | null; right: DiffCell | null } | { kind: 'skip'; count: number }

export interface SideBySide {
  rows: DiffRow[]
  added: number
  removed: number
}

const OPTIONS = { ignoreNewlineAtEof: true }

function splitLines(value: string): string[] {
  const out = value.split('\n')
  if (out.at(-1) === '') out.pop()
  return out
}

export function countLineChanges(oldCode: string, newCode: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const c of diffLines(oldCode, newCode, OPTIONS)) {
    if (c.added) added += splitLines(c.value).length
    else if (c.removed) removed += splitLines(c.value).length
  }
  return { added, removed }
}

type Pair = { left: DiffCell | null; right: DiffCell | null }

export function sideBySide(oldCode: string, newCode: string, context = 3): SideBySide {
  const changes = diffLines(oldCode, newCode, OPTIONS)
  const pairs: Pair[] = []
  let l = 1
  let r = 1
  let added = 0
  let removed = 0

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]!
    const text = splitLines(c.value)
    if (c.removed) {
      const next = changes[i + 1]
      const addedText = next?.added ? splitLines(next.value) : []
      if (next?.added) i++
      const n = Math.max(text.length, addedText.length)
      for (let k = 0; k < n; k++) {
        pairs.push({
          left: k < text.length ? { line: l++, text: text[k]!, kind: 'del' } : null,
          right: k < addedText.length ? { line: r++, text: addedText[k]!, kind: 'add' } : null,
        })
      }
      removed += text.length
      added += addedText.length
    } else if (c.added) {
      for (const t of text) pairs.push({ left: null, right: { line: r++, text: t, kind: 'add' } })
      added += text.length
    } else {
      for (const t of text) pairs.push({ left: { line: l++, text: t, kind: 'same' }, right: { line: r++, text: t, kind: 'same' } })
    }
  }

  const rows: DiffRow[] = []
  const same = (p: Pair) => p.left?.kind === 'same'
  let i = 0
  while (i < pairs.length) {
    if (!same(pairs[i]!)) {
      rows.push({ kind: 'pair', ...pairs[i]! })
      i++
      continue
    }
    let j = i
    while (j < pairs.length && same(pairs[j]!)) j++
    const before = i === 0 ? 0 : context
    const after = j === pairs.length ? 0 : context
    if (j - i > before + after + 1) {
      for (let k = i; k < i + before; k++) rows.push({ kind: 'pair', ...pairs[k]! })
      rows.push({ kind: 'skip', count: j - i - before - after })
      for (let k = j - after; k < j; k++) rows.push({ kind: 'pair', ...pairs[k]! })
    } else {
      for (let k = i; k < j; k++) rows.push({ kind: 'pair', ...pairs[k]! })
    }
    i = j
  }
  return { rows, added, removed }
}
```

`src/history/messages.ts`:

```ts
import { paramValueEqual, type Params } from '../render/params'
import type { ParamValue } from '../render/types'
import { countLineChanges } from './diff'

/** First line only, cut at `max` characters with an ellipsis. */
export function truncate(text: string, max = 120): string {
  const first = text.trim().split('\n')[0]!.trim()
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

export function formatValue(v: ParamValue): string {
  return Array.isArray(v) ? `[${v.join(', ')}]` : String(v)
}

/** "height 18 → 22" from the effective values before and after. */
export function describeParamChanges(before: Params, after: Params): string {
  const parts = Object.keys(after)
    .filter((k) => !Object.hasOwn(before, k) || !paramValueEqual(before[k]!, after[k]!))
    .map((k) => (Object.hasOwn(before, k) ? `${k} ${formatValue(before[k]!)} → ${formatValue(after[k]!)}` : `${k} ${formatValue(after[k]!)}`))
  if (parts.length === 0) return 'Parameters unchanged'
  return parts.length > 3 ? `${parts.slice(0, 3).join(', ')} and ${parts.length - 3} more` : parts.join(', ')
}

export function manualMessage(oldCode: string, newCode: string): string {
  const { added, removed } = countLineChanges(oldCode, newCode)
  return `Edited code · +${added} −${removed} lines`
}

export function bakeMessage(names: string[]): string {
  return names.length > 0 ? `Baked ${names.join(', ')} into code` : 'Baked parameters into code'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/history/diff.test.ts && npm run typecheck`
Expected: PASS (7 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/history/diff.ts src/history/messages.ts src/history/diff.test.ts
git commit -m "feat(history): side-by-side line diff and version messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Project store

**Files:**
- Create: `src/history/projectStore.ts`, `src/history/matchesHead.ts`
- Test: `src/history/projectStore.test.ts`

**Interfaces:**
- Consumes: `createVersion`, `listVersions`, `updateVersion`, `VersionPatch` (Task 7); `putProject`, `getProject`, `listRecentProjects`, `deleteProjectCascade` (Task 6); `useSettingsStore` (Task 6); `useAppStore` (`setCode`, `setParams`, `setLibraries`, Task 3); `paramOverrides` (Task 2); `paramsEqual`, `Params` (Task 2).
- Produces:
  - `src/history/matchesHead.ts`: `matchesHead(code: string, params: Params, head: Version | null): boolean` (the editor's code and its effective overrides equal the head version's).
  - `src/history/projectStore.ts` (contract names plus extras): `useProjectStore` with state `project: Project | null`, `versions: Version[]` (oldest first), `head: Version | null`, `redoStack: string[]`, `recent: Project[]`, and actions
    - `openProject(id: string): Promise<void>`, `newProject(opts: NewProjectOptions): Promise<Project>`, `restore(versionId: string): Promise<Version>`, `branchFrom(versionId: string): Promise<void>`, `undo(): Promise<void>`, `redo(): Promise<void>` (contract);
    - `commit(input: CommitInput): Promise<Version>` (child of the head, becomes the head, clears redo), `patchVersion(id: string, patch: VersionPatch): Promise<void>`, `renameProject(name: string): Promise<void>`, `deleteProject(id: string): Promise<void>`, `setEnabledLibraries(libraries: string[]): Promise<void>`, `refreshRecent(): Promise<void>`.
  - `interface NewProjectOptions { name?: string; code: string; params?: Params; origin: Project['origin']; source?: VersionSource; message?: string; enabledLibraries?: string[] }` (defaults: name "Untitled project", source `'manual'`, message "New project").
  - `type CommitInput = Pick<Version, 'code' | 'params' | 'source' | 'message' | 'model' | 'compileStatus' | 'renderMs'>`.
  - `onBeforeLeaveHead(fn: (() => Promise<void>) | null): void`: every action that moves the head away from what the editor shows (`openProject`, `newProject`, `restore`, `branchFrom`, `undo`, `redo`, `deleteProject`) awaits this first; the recorder (Task 11) registers its `flush` here so pending edits become a version before they would be lost.
  - `currentLibraries(): string[]`.
  - Loading a version into the editor sets the head first, then calls `setCode(code, 'restore')` and `setParams(params)`, so the recorder sees an editor that matches the head and records nothing.
  - The first project ever created calls `navigator.storage.persist()` (spec "Projects and version history").

- [ ] **Step 1: Write the failing test**

`src/history/projectStore.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { getProject } from '../db/projects'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { matchesHead } from './matchesHead'
import { currentLibraries, onBeforeLeaveHead, useProjectStore } from './projectStore'

const CODE = 'w = 10; // [1:1:50]\ncube(w);'

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  onBeforeLeaveHead(null)
})
afterEach(() => vi.unstubAllGlobals())

const store = () => useProjectStore.getState()
const commit = (code: string, params = {}) =>
  store().commit({ code, params, source: 'manual', message: 'edit', model: null, compileStatus: 'ok', renderMs: 1 })

it('creates a project with version 1 and loads it into the editor', async () => {
  const persist = vi.fn(async () => true)
  vi.stubGlobal('navigator', { storage: { persist } })
  const project = await store().newProject({ name: 'Holder', code: CODE, params: { w: 20 }, origin: 'gallery', source: 'gallery', message: 'Started from Holder', enabledLibraries: ['MCAD'] })

  expect(store().head).toMatchObject({ label: 'v1', source: 'gallery', message: 'Started from Holder', compileStatus: 'pending', parentId: null })
  expect(project).toMatchObject({ name: 'Holder', origin: 'gallery', headVersionId: store().head!.id })
  expect(useAppStore.getState()).toMatchObject({ code: CODE, params: { w: 20 }, libraries: ['MCAD'], codeSource: 'restore' })
  expect(useSettingsStore.getState().settings.lastProjectId).toBe(project.id)
  expect(store().recent.map((p) => p.id)).toEqual([project.id])
  expect(currentLibraries()).toEqual(['MCAD'])
  expect(persist).toHaveBeenCalledTimes(1)

  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  expect(store().project?.name).toBe('Untitled project')
  expect(store().head).toMatchObject({ source: 'manual', message: 'New project' })
  expect(persist).toHaveBeenCalledTimes(1)
})

it('commits children of the head, persists the head and clears redo', async () => {
  await store().newProject({ code: CODE, origin: 'blank' })
  const v2 = await commit('cube(2);')
  const v3 = await commit('cube(3);')
  expect(store().versions.map((v) => v.label)).toEqual(['v1', 'v2', 'v3'])
  expect(v3.parentId).toBe(v2.id)
  expect((await getProject(store().project!.id))?.headVersionId).toBe(v3.id)
})

it('moves along the ancestry with undo and redo', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  await commit('cube(2);')
  await commit('cube(3);')

  await store().undo()
  expect(store().head?.label).toBe('v2')
  expect(useAppStore.getState().code).toBe('cube(2);')
  await store().undo()
  await store().undo()
  expect(store().head?.label).toBe('v1')

  await store().redo()
  await store().redo()
  expect(store().head?.label).toBe('v3')
  expect(useAppStore.getState().code).toBe('cube(3);')
  await store().redo()
  expect(store().head?.label).toBe('v3')

  await store().undo()
  await commit('cube(4);')
  expect(store().redoStack).toEqual([])
})

it('restores an older version as a new version with its code and parameters', async () => {
  await store().newProject({ code: CODE, params: { w: 30 }, origin: 'blank' })
  const v1 = store().head!
  await commit('cube(2);')
  const restored = await store().restore(v1.id)
  expect(restored).toMatchObject({ label: 'v3', source: 'restore', message: 'Restored v1', code: CODE, params: { w: 30 }, compileStatus: 'pending' })
  expect(store().head?.id).toBe(restored.id)
  expect(useAppStore.getState()).toMatchObject({ code: CODE, params: { w: 30 } })
  expect(await store().restore(restored.id)).toBe(store().head)
  expect(store().versions).toHaveLength(3)
})

it('branches from an older version without creating one; the next commit becomes a branch', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  const v2 = await commit('cube(2);')
  await commit('cube(3);')
  await store().branchFrom(v2.id)
  expect(store().versions).toHaveLength(3)
  expect(store().head?.id).toBe(v2.id)
  expect(useAppStore.getState().code).toBe('cube(2);')
  expect((await commit('cube(22);')).label).toBe('v2.1')
})

it('opens a project at its head with its libraries, falling back to the newest version', async () => {
  const first = await store().newProject({ code: 'cube(1);', origin: 'blank', enabledLibraries: ['BOSL2'] })
  await commit('cube(2);')
  await store().newProject({ code: 'sphere(1);', origin: 'blank' })

  await store().openProject(first.id)
  expect(store().head?.label).toBe('v2')
  expect(useAppStore.getState()).toMatchObject({ code: 'cube(2);', libraries: ['BOSL2'] })
  expect(useSettingsStore.getState().settings.lastProjectId).toBe(first.id)

  await db.projects.update(first.id, { headVersionId: 'gone' })
  await store().openProject(first.id)
  expect(store().head?.label).toBe('v2')
  await expect(store().openProject('missing')).rejects.toThrow('Project missing not found')
})

it('awaits the before-leave hook before moving the head', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  const v2 = await commit('cube(2);')
  const calls: string[] = []
  onBeforeLeaveHead(async () => {
    calls.push(`flush at ${store().head?.label}`)
  })
  await store().undo()
  await store().redo()
  await store().restore(store().versions[0]!.id)
  await store().branchFrom(v2.id)
  await store().openProject(store().project!.id)
  await store().newProject({ code: 'x', origin: 'blank' })
  expect(calls).toEqual(['flush at v2', 'flush at v1', 'flush at v2', 'flush at v3', 'flush at v2', 'flush at v2'])
})

it('deletes the open project and opens the most recent other one, or starts a blank one', async () => {
  const a = await store().newProject({ name: 'A', code: 'cube(1);', origin: 'blank' })
  const b = await store().newProject({ name: 'B', code: 'cube(2);', origin: 'blank' })
  await store().deleteProject(b.id)
  expect(store().project?.id).toBe(a.id)
  expect(await db.versions.where('projectId').equals(b.id).count()).toBe(0)

  useAppStore.getState().setCode('sphere(9);')
  await store().deleteProject(a.id)
  expect(store().project).toMatchObject({ name: 'Untitled project', origin: 'blank' })
  expect(store().head?.code).toBe('sphere(9);')
})

it('renames, sets libraries and patches versions', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  await store().renameProject('  Clip  ')
  expect(store().project?.name).toBe('Clip')
  await store().renameProject('   ')
  expect(store().project?.name).toBe('Clip')

  await store().setEnabledLibraries(['BOSL2'])
  expect(useAppStore.getState().libraries).toEqual(['BOSL2'])
  expect((await getProject(store().project!.id))?.enabledLibraries).toEqual(['BOSL2'])

  await store().patchVersion(store().head!.id, { compileStatus: 'ok', renderMs: 9 })
  expect(store().head).toMatchObject({ compileStatus: 'ok', renderMs: 9 })
  expect(store().versions[0]).toMatchObject({ compileStatus: 'ok' })
})

it('matches the head on code plus effective overrides', async () => {
  await store().newProject({ code: CODE, params: { w: 20 }, origin: 'blank' })
  const head = store().head
  expect(matchesHead(CODE, { w: 20 }, head)).toBe(true)
  expect(matchesHead(CODE, { w: 20, nope: 1 }, head)).toBe(true)
  expect(matchesHead(CODE, { w: 10 }, head)).toBe(false)
  expect(matchesHead(`${CODE}\n`, { w: 20 }, head)).toBe(false)
  expect(matchesHead(CODE, {}, null)).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/history/projectStore.test.ts`
Expected: FAIL with "Failed to resolve import './matchesHead'".

- [ ] **Step 3: Write minimal implementation**

`src/history/matchesHead.ts`:

```ts
import type { Version } from '../db/db'
import { paramsEqual, type Params } from '../render/params'
import { paramOverrides } from '../scad/customizer'

/** True when the editor shows exactly the head version: same code, same effective overrides. */
export function matchesHead(code: string, params: Params, head: Version | null): boolean {
  return head !== null && code === head.code && paramsEqual(paramOverrides(code, params), head.params)
}
```

`src/history/projectStore.ts`:

```ts
import { create } from 'zustand'
import type { Project, Version, VersionSource } from '../db/db'
import { deleteProjectCascade, getProject, listRecentProjects, putProject } from '../db/projects'
import type { Params } from '../render/params'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { createVersion, listVersions, updateVersion, type VersionPatch } from './versions'

export const UNTITLED = 'Untitled project'

export interface NewProjectOptions {
  name?: string
  code: string
  params?: Params
  origin: Project['origin']
  source?: VersionSource
  message?: string
  enabledLibraries?: string[]
}

export type CommitInput = Pick<Version, 'code' | 'params' | 'source' | 'message' | 'model' | 'compileStatus' | 'renderMs'>

export interface ProjectState {
  project: Project | null
  versions: Version[]
  head: Version | null
  /** Version ids undone from, most recent last; redo pops. */
  redoStack: string[]
  recent: Project[]
  openProject(id: string): Promise<void>
  newProject(opts: NewProjectOptions): Promise<Project>
  restore(versionId: string): Promise<Version>
  branchFrom(versionId: string): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  commit(input: CommitInput): Promise<Version>
  patchVersion(id: string, patch: VersionPatch): Promise<void>
  renameProject(name: string): Promise<void>
  deleteProject(id: string): Promise<void>
  setEnabledLibraries(libraries: string[]): Promise<void>
  refreshRecent(): Promise<void>
}

let beforeLeave: () => Promise<void> = async () => {}

/** The recorder registers its flush here, so pending edits become a version before the head moves. */
export function onBeforeLeaveHead(fn: (() => Promise<void>) | null): void {
  beforeLeave = fn ?? (async () => {})
}

function loadIntoEditor(version: Version): void {
  const app = useAppStore.getState()
  app.setCode(version.code, 'restore')
  app.setParams(version.params)
}

async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch {
    // Not supported or refused; Settings › Storage and backup shows the state and can ask again.
  }
}

export const currentLibraries = (): string[] => useProjectStore.getState().project?.enabledLibraries ?? []

export const useProjectStore = create<ProjectState>()((set, get) => {
  async function moveHead(target: Version, redoStack: string[]): Promise<void> {
    const project = get().project!
    const updated: Project = { ...project, headVersionId: target.id, updatedAt: Date.now() }
    await putProject(updated)
    set({ project: updated, head: target, redoStack })
    loadIntoEditor(target)
  }

  async function opened(project: Project): Promise<void> {
    await useSettingsStore.getState().update({ lastProjectId: project.id })
    await get().refreshRecent()
  }

  return {
    project: null,
    versions: [],
    head: null,
    redoStack: [],
    recent: [],

    async openProject(id) {
      await beforeLeave()
      const project = await getProject(id)
      if (!project) throw new Error(`Project ${id} not found`)
      const versions = await listVersions(id)
      const head = versions.find((v) => v.id === project.headVersionId) ?? versions.at(-1) ?? null
      set({ project, versions, head, redoStack: [] })
      useAppStore.getState().setLibraries(project.enabledLibraries)
      if (head) loadIntoEditor(head)
      await opened(project)
    },

    async newProject(opts) {
      await beforeLeave()
      const isFirst = (await listRecentProjects(1)).length === 0
      const t = Date.now()
      const draft: Project = {
        id: crypto.randomUUID(),
        name: opts.name ?? UNTITLED,
        createdAt: t,
        updatedAt: t,
        headVersionId: null,
        providerProfileId: null,
        enabledLibraries: opts.enabledLibraries ?? [],
        origin: opts.origin,
      }
      await putProject(draft)
      const v1 = await createVersion({
        projectId: draft.id,
        parentId: null,
        code: opts.code,
        params: opts.params ?? {},
        source: opts.source ?? 'manual',
        kind: 'main',
        variantGroupId: null,
        message: opts.message ?? 'New project',
        model: null,
        compileStatus: 'pending',
        renderMs: null,
        thumbnailBlobId: null,
      })
      const project: Project = { ...draft, headVersionId: v1.id }
      await putProject(project)
      set({ project, versions: [v1], head: v1, redoStack: [] })
      useAppStore.getState().setLibraries(project.enabledLibraries)
      loadIntoEditor(v1)
      await opened(project)
      if (isFirst) await requestPersistentStorage()
      return project
    },

    async commit(input) {
      const { project, head } = get()
      if (!project) throw new Error('No project is open')
      const version = await createVersion({
        ...input,
        projectId: project.id,
        parentId: head?.id ?? null,
        kind: 'main',
        variantGroupId: null,
        thumbnailBlobId: null,
      })
      const updated: Project = { ...project, headVersionId: version.id, updatedAt: version.createdAt }
      await putProject(updated)
      set((s) => ({ project: updated, versions: [...s.versions, version], head: version, redoStack: [] }))
      return version
    },

    async patchVersion(id, patch) {
      await updateVersion(id, patch)
      set((s) => ({
        versions: s.versions.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        head: s.head?.id === id ? { ...s.head, ...patch } : s.head,
      }))
    },

    async restore(versionId) {
      await beforeLeave()
      const target = get().versions.find((v) => v.id === versionId)
      if (!target) throw new Error(`Version ${versionId} is not in this project`)
      const head = get().head
      if (head?.id === target.id) return head
      const version = await get().commit({
        code: target.code,
        params: target.params,
        source: 'restore',
        message: `Restored ${target.label}`,
        model: null,
        compileStatus: 'pending',
        renderMs: null,
      })
      loadIntoEditor(version)
      return version
    },

    async branchFrom(versionId) {
      await beforeLeave()
      const target = get().versions.find((v) => v.id === versionId)
      if (!target) throw new Error(`Version ${versionId} is not in this project`)
      await moveHead(target, [])
    },

    async undo() {
      await beforeLeave()
      const { head, versions, redoStack } = get()
      const parent = head?.parentId ? versions.find((v) => v.id === head.parentId) : undefined
      if (!head || !parent) return
      await moveHead(parent, [...redoStack, head.id])
    },

    async redo() {
      await beforeLeave()
      const { head, versions, redoStack } = get()
      const id = redoStack.at(-1)
      const target = id ? versions.find((v) => v.id === id) : undefined
      if (!head || !target || target.parentId !== head.id) {
        if (redoStack.length > 0 && (!target || target.parentId !== head?.id)) set({ redoStack: [] })
        return
      }
      await moveHead(target, redoStack.slice(0, -1))
    },

    async renameProject(name) {
      const project = get().project
      const trimmed = name.trim()
      if (!project || trimmed === '') return
      const updated: Project = { ...project, name: trimmed, updatedAt: Date.now() }
      await putProject(updated)
      set({ project: updated })
      await get().refreshRecent()
    },

    async deleteProject(id) {
      const isCurrent = get().project?.id === id
      if (isCurrent) set({ project: null, versions: [], head: null, redoStack: [] })
      await deleteProjectCascade(id)
      await get().refreshRecent()
      if (!isCurrent) return
      const next = get().recent[0]
      if (next) await get().openProject(next.id)
      else await get().newProject({ code: useAppStore.getState().code, origin: 'blank' })
    },

    async setEnabledLibraries(libraries) {
      const project = get().project
      if (!project) return
      const updated: Project = { ...project, enabledLibraries: libraries, updatedAt: Date.now() }
      await putProject(updated)
      set({ project: updated })
      useAppStore.getState().setLibraries(libraries)
    },

    async refreshRecent() {
      set({ recent: await listRecentProjects(8) })
    },
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/history/projectStore.test.ts && npm run typecheck`
Expected: PASS (10 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/history/projectStore.ts src/history/matchesHead.ts src/history/projectStore.test.ts
git commit -m "feat(history): project store with restore, branch, undo and redo along the ancestry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Thumbnail capture and the version-aware stale label

**Files:**
- Create: `src/viewer/thumbnail.ts`, `src/viewer/staleText.ts`
- Modify: `src/viewer/Viewer.tsx`
- Test: `src/viewer/thumbnail.test.ts`

**Interfaces:**
- Consumes: react-three-fiber `useThree` (`gl`, `scene`, `camera`).
- Produces:
  - `src/viewer/thumbnail.ts`: `THUMBNAIL_SIZE = 96`; `type ThumbnailSource = () => HTMLCanvasElement | null`; `setThumbnailSource(fn: ThumbnailSource | null): void`; `squareCrop(width: number, height: number): { sx: number; sy: number; size: number }`; `interface CaptureDeps { nextFrame?(): Promise<void>; createCanvas?(size: number): HTMLCanvasElement }`; `captureThumbnail(deps?: CaptureDeps): Promise<Blob | null>` (96 × 96 PNG of the centre square, or `null` when no viewer is mounted or the canvas is empty).
  - `src/viewer/staleText.ts`: `staleText(versionLabel: string | null): string` → "Showing v3, the last version that compiled" or, without a label, M1's "Showing the last model that compiled".
  - `Viewer` props gain `thumbnails?: boolean` (registers the thumbnail source; only the workbench viewer sets it) and `staleLabel?: string | null`.

**Capture method (decision):** render on demand and copy in the same task, not `preserveDrawingBuffer: true`. `ThumbnailRegistrar` registers a source that calls `gl.render(scene, camera)` and returns `gl.domElement`; `captureThumbnail` then calls `drawImage` from that canvas into a 96 px 2D canvas synchronously, before the browser composites and clears the WebGL drawing buffer, and only then encodes the PNG asynchronously from the 2D copy. `preserveDrawingBuffer` would make every frame copy instead of swap buffers (a real cost on mobile GPUs) to serve a rare event, and a `useFrame` hook would still need to force a frame under `frameloop="demand"`. Waiting two animation frames first lets React commit the mesh of the render that just finished.

- [ ] **Step 1: Write the failing test**

`src/viewer/thumbnail.test.ts`:

```ts
import { staleText } from './staleText'
import { captureThumbnail, setThumbnailSource, squareCrop, THUMBNAIL_SIZE } from './thumbnail'

afterEach(() => setThumbnailSource(null))

const noFrame = async () => {}

function fakeCanvas(events: string[], context: object | null = { drawImage: vi.fn(() => events.push('draw')) }) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (cb: BlobCallback, type?: string) => {
      events.push(`encode ${type}`)
      cb(new Blob(['png'], { type }))
    },
  }
  return { canvas, context, create: (size: number) => Object.assign(canvas, { width: size, height: size }) as unknown as HTMLCanvasElement }
}

it('crops the centre square of a wide or tall canvas', () => {
  expect(squareCrop(800, 600)).toEqual({ sx: 100, sy: 0, size: 600 })
  expect(squareCrop(300, 500)).toEqual({ sx: 0, sy: 100, size: 300 })
})

it('returns null when no viewer is registered', async () => {
  expect(await captureThumbnail({ nextFrame: noFrame })).toBeNull()
})

it('waits a frame, renders, copies the centre square into a 96 px canvas in the same task, then encodes a PNG', async () => {
  const events: string[] = []
  const src = { width: 800, height: 600 } as HTMLCanvasElement
  setThumbnailSource(() => {
    events.push('render')
    return src
  })
  const { canvas, context, create } = fakeCanvas(events)
  const blob = await captureThumbnail({ nextFrame: async () => void events.push('frame'), createCanvas: create })
  expect(events).toEqual(['frame', 'render', 'draw', 'encode image/png'])
  expect((context as { drawImage: ReturnType<typeof vi.fn> }).drawImage).toHaveBeenCalledWith(src, 100, 0, 600, 600, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  expect(canvas.width).toBe(96)
  expect(blob?.type).toBe('image/png')
})

it('returns null for an empty canvas or a missing 2D context', async () => {
  setThumbnailSource(() => ({ width: 0, height: 0 }) as HTMLCanvasElement)
  expect(await captureThumbnail({ nextFrame: noFrame, createCanvas: fakeCanvas([]).create })).toBeNull()
  setThumbnailSource(() => ({ width: 10, height: 10 }) as HTMLCanvasElement)
  expect(await captureThumbnail({ nextFrame: noFrame, createCanvas: fakeCanvas([], null).create })).toBeNull()
})

it('names the version the stale model came from when it is known', () => {
  expect(staleText('v3')).toBe('Showing v3, the last version that compiled')
  expect(staleText(null)).toBe('Showing the last model that compiled')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/viewer/thumbnail.test.ts`
Expected: FAIL with "Failed to resolve import './staleText'".

- [ ] **Step 3: Write minimal implementation**

`src/viewer/thumbnail.ts`:

```ts
export const THUMBNAIL_SIZE = 96

/** Renders the current scene and returns the WebGL canvas; registered by the workbench viewer. */
export type ThumbnailSource = () => HTMLCanvasElement | null

let source: ThumbnailSource | null = null

export function setThumbnailSource(fn: ThumbnailSource | null): void {
  source = fn
}

export function squareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height)
  return { sx: (width - size) / 2, sy: (height - size) / 2, size }
}

export interface CaptureDeps {
  nextFrame?(): Promise<void>
  createCanvas?(size: number): HTMLCanvasElement
}

const twoFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

function newCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

/** 96 px PNG of the viewer's centre square, or null when no viewer is mounted. */
export async function captureThumbnail(deps: CaptureDeps = {}): Promise<Blob | null> {
  if (!source) return null
  await (deps.nextFrame ?? twoFrames)()
  const src = source?.()
  if (!src || src.width === 0 || src.height === 0) return null
  const canvas = (deps.createCanvas ?? newCanvas)(THUMBNAIL_SIZE)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Same task as the render above, so the WebGL drawing buffer still holds the frame.
  const { sx, sy, size } = squareCrop(src.width, src.height)
  ctx.drawImage(src, sx, sy, size, size, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}
```

`src/viewer/staleText.ts`:

```ts
export function staleText(versionLabel: string | null): string {
  return versionLabel ? `Showing ${versionLabel}, the last version that compiled` : 'Showing the last model that compiled'
}
```

`src/viewer/Viewer.tsx`: three changes; the rest of the file stays as in M1.

1. Add imports:

```ts
import { staleText } from './staleText'
import { setThumbnailSource } from './thumbnail'
```

2. Add this component above `export function Viewer`:

```tsx
/** Lets captureThumbnail() render this scene on demand and read the canvas in the same task. */
function ThumbnailRegistrar() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    setThumbnailSource(() => {
      gl.render(scene, camera)
      return gl.domElement
    })
    return () => setThumbnailSource(null)
  }, [gl, scene, camera])
  return null
}
```

3. Replace the `Viewer` signature, add the registrar inside `<Canvas>` (after `<CameraFitter … />`), and use `staleText` in the stale pill:

```tsx
export function Viewer({
  mesh,
  stale,
  thumbnails = false,
  staleLabel = null,
}: {
  mesh: MeshData | null
  stale: boolean
  thumbnails?: boolean
  staleLabel?: string | null
}) {
```

```tsx
        <CameraFitter bounds={mesh?.bounds ?? null} fitToken={fitToken} />
        {thumbnails && <ThumbnailRegistrar />}
      </Canvas>
```

```tsx
          <span className="pc-status is-warn">
            <IconWarning className="pc-i" aria-hidden="true" />
            {staleText(staleLabel)}
          </span>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/viewer && npm run typecheck`
Expected: PASS (5 new tests plus M1's viewer tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/thumbnail.ts src/viewer/staleText.ts src/viewer/thumbnail.test.ts src/viewer/Viewer.tsx
git commit -m "feat(viewer): 96 px thumbnail capture and the version-aware stale label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Version recorder

**Files:**
- Create: `src/history/recorder.ts`
- Test: `src/history/recorder.test.ts`

**Interfaces:**
- Consumes: `useAppStore` (`code`, `params`, `codeSource`, `lastRender`, `renderedParams`, Task 3); `useProjectStore` (`head`, `versions`, `commit`, `patchVersion`), `CommitInput` (Task 9); `matchesHead` (Task 9); `paramOverrides`, `effectiveValues` (Task 2); `manualMessage`, `describeParamChanges`, `bakeMessage`, `truncate` (Task 8); `putBlob` (Task 6); `useChatStore` and `ChatMessage` (M2, see "Contract issues": the store hook is assumed to be `useChatStore` with `messages: ChatMessage[]`).
- Produces:
  - `IDLE_COMMIT_MS = 30_000`.
  - `interface TurnInfo { prompt: string | null; reply: string | null; model: string | null }`; `describeChatTurn(): TurnInfo` (last user message, last assistant message and its model).
  - `interface RecorderDeps { idleMs?: number; capture?(): Promise<Blob | null>; describeTurn?(): TurnInfo; onCommit?(version: Version): void | Promise<void> }`.
  - `interface Recorder { flush(): Promise<void>; settled(): Promise<void>; stop(): void }`; `startRecorder(deps?: RecorderDeps): Recorder`; `flushRecorder(): void` (flushes the running recorder; the editor calls it on blur).
- Behaviour (spec "Projects and version history"):
  - Code changes from `ai`, `autofix`, `restore` (M2's "Back to vN"), `gallery`, `import` and `slider` (Bake into code) become a version at once, with `compileStatus: 'pending'`; a pending manual or slider change is committed first (a pending slider change is dropped when a Bake supersedes it).
  - Manual code edits and parameter changes are coalesced: one version on the next successful render of exactly that code and those parameters, on `flush()` (editor blur, before the head moves), or after 30 s without changes.
  - An editor that matches the head (code plus effective overrides) never creates a version: undo, redo, branch, open and project-store restores load the head first.
  - When a render finishes for the head and the head is `pending`, its status and time are filled in; every version that compiled gets a 96 px thumbnail from `capture()`.
  - Messages: AI → the prompt (first line, 120 characters); auto-fix → "Auto-fix: " + the reply's first line; manual → "Edited code · +2 −1 lines"; slider → "height 18 → 22"; bake → "Baked height into code"; restore → "Restored v1" when a version has that code and parameters, else "Restored earlier code".
  - The source of a change is read when the code changes, so the editor echoing the same code back through `setCode(code)` (source `'manual'`) cannot turn an AI version into a manual edit.
  - All database work is serialised in one queue; failures are logged with `console.error` and never break the editor.

- [ ] **Step 1: Write the failing test**

`src/history/recorder.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { useChatStore, type ChatMessage } from '../chat/chatStore'
import { bakeParams } from '../scad/customizer'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { errorResult, okResult } from '../test/results'
import { onBeforeLeaveHead, useProjectStore } from './projectStore'
import { describeChatTurn, startRecorder, type Recorder, type TurnInfo } from './recorder'

const CODE = 'w = 10; // [1:1:50]\ncube(w);'
const EDITED = 'w = 10; // [1:1:50]\ncube(w + 1);'
const turn: TurnInfo = { prompt: 'Make it taller', reply: 'Raised the height.\nNothing else changed.', model: 'gpt-x' }
const capture = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
const onCommit = vi.fn()
let recorder: Recorder

const app = () => useAppStore.getState()
const project = () => useProjectStore.getState()
const labels = () => project().versions.map((v) => `${v.label} ${v.source} ${v.compileStatus} ${v.message}`)
const rendered = (ok = true) => {
  const s = app()
  s.renderFinished(ok ? okResult() : errorResult(), s.code, s.params)
}

async function start(idleMs = 30_000) {
  recorder = startRecorder({ idleMs, capture, describeTurn: () => turn, onCommit })
}

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useChatStore.setState({ messages: [] })
  onBeforeLeaveHead(null)
  await project().newProject({ code: CODE, origin: 'blank' })
  capture.mockClear()
  onCommit.mockClear()
})
afterEach(() => {
  recorder.stop()
  vi.useRealTimers()
})

it('fills in the status, time and thumbnail of a pending head when its render finishes', async () => {
  await start()
  rendered()
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual ok New project'])
  expect(project().head).toMatchObject({ renderMs: 12, thumbnailBlobId: expect.any(String) })
  expect(capture).toHaveBeenCalledTimes(1)
})

it('coalesces manual edits into one version on the next successful render', async () => {
  await start()
  app().setCode(`${EDITED} `)
  app().setCode(EDITED)
  await recorder.settled()
  expect(project().versions).toHaveLength(1)

  rendered()
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 manual ok Edited code · +1 −1 lines'])
  expect(project().head).toMatchObject({ code: EDITED, renderMs: 12, thumbnailBlobId: expect.any(String) })
  expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ label: 'v2' }))
})

it('does not commit on a failed render, but does on blur, with the error status', async () => {
  await start()
  app().setCode('cube(')
  await recorder.settled()
  rendered(false)
  await recorder.settled()
  expect(project().versions).toHaveLength(1)

  await recorder.flush()
  expect(labels().at(-1)).toBe('v2 manual error Edited code · +1 −2 lines')
  expect(capture).not.toHaveBeenCalled()
})

it('commits a pending edit after 30 s without changes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await start()
  app().setCode(EDITED)
  await recorder.settled()
  await vi.advanceTimersByTimeAsync(29_999)
  await recorder.settled()
  expect(project().versions).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  await recorder.settled()
  expect(labels().at(-1)).toBe('v2 manual pending Edited code · +1 −1 lines')
})

it('records a slider change with old and new values, and nothing when it is moved back', async () => {
  await start()
  app().setParams({ w: 20 })
  app().setParams({ w: 10 })
  await recorder.settled()
  rendered()
  await recorder.settled()
  expect(project().versions).toHaveLength(1)

  app().setParams({ w: 20 })
  await recorder.settled()
  rendered()
  await recorder.settled()
  expect(labels().at(-1)).toBe('v2 slider ok w 10 → 20')
  expect(project().head?.params).toEqual({ w: 20 })
})

it('records an AI change at once with the prompt and model, then its render result', async () => {
  await start()
  app().setCode('cube(5);', 'ai')
  await recorder.settled()
  expect(project().head).toMatchObject({ label: 'v2', source: 'ai', compileStatus: 'pending', message: 'Make it taller', model: 'gpt-x' })
  rendered(false)
  await recorder.settled()
  expect(project().head?.compileStatus).toBe('error')

  app().setCode('cube(6);', 'autofix')
  await recorder.settled()
  expect(project().head).toMatchObject({ label: 'v3', source: 'autofix', message: 'Auto-fix: Raised the height.' })
})

it('keeps the source of a code change when the editor echoes the same code back as manual', async () => {
  await start()
  app().setCode('cube(5);', 'ai')
  app().setCode('cube(5);')
  await recorder.settled()
  expect(project().head).toMatchObject({ label: 'v2', source: 'ai' })
})

it('saves a pending manual edit as its own version before an AI change', async () => {
  await start()
  app().setCode(EDITED)
  await recorder.settled()
  app().setCode('cube(5);', 'ai')
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 manual pending Edited code · +1 −1 lines', 'v3 ai pending Make it taller'])
  expect(project().versions[2]!.parentId).toBe(project().versions[1]!.id)
})

it('records Bake into code as one slider version that supersedes the pending slider change', async () => {
  await start()
  app().setParams({ w: 20 })
  await recorder.settled()
  app().setCode(bakeParams(CODE, { w: 20 }), 'slider')
  app().setParams({})
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 slider pending Baked w into code'])
  expect(project().head).toMatchObject({ code: 'w = 20; // [1:1:50]\ncube(w);', params: {} })
})

it('records nothing extra for project-store restores and undo, and labels an editor restore', async () => {
  await start()
  const v1 = project().head!
  app().setCode(EDITED)
  await recorder.flush()
  await project().restore(v1.id)
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 manual pending Edited code · +1 −1 lines', 'v3 restore pending Restored v1'])
  rendered()
  await recorder.settled()
  expect(project().head?.compileStatus).toBe('ok')

  await project().undo()
  await recorder.settled()
  expect(project().versions).toHaveLength(3)

  // M2's "Back to vN" sets older code with the 'restore' source. The head is v2 again after the undo.
  app().setCode(EDITED, 'restore')
  await recorder.settled()
  expect(labels()).toHaveLength(3)
  app().setCode(CODE, 'restore')
  await recorder.settled()
  expect(labels().at(-1)).toBe('v2.1 restore ok Restored v1')
  app().setCode('cube(42);', 'restore')
  await recorder.settled()
  expect(labels().at(-1)).toBe('v2.2 restore pending Restored earlier code')
})

it('flushes a pending edit before the head moves', async () => {
  await start()
  onBeforeLeaveHead(() => recorder.flush())
  app().setCode(EDITED)
  await recorder.settled()
  await project().undo()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 manual pending Edited code · +1 −1 lines'])
  expect(project().head?.label).toBe('v1')
  expect(app().code).toBe(CODE)
})

it('stops listening when stopped', async () => {
  await start()
  recorder.stop()
  app().setCode('cube(5);', 'ai')
  await recorder.settled()
  expect(project().versions).toHaveLength(1)
})

it('describes the latest chat turn', () => {
  const msg = (role: ChatMessage['role'], text: string, model: string | null = null): ChatMessage => ({
    id: crypto.randomUUID(), role, text, turnLabel: null, model, usage: null, status: 'done',
  })
  useChatStore.setState({ messages: [msg('user', 'first'), msg('assistant', 'one', 'm1'), msg('user', 'second'), msg('assistant', 'two', 'm2')] })
  expect(describeChatTurn()).toEqual({ prompt: 'second', reply: 'two', model: 'm2' })
  useChatStore.setState({ messages: [] })
  expect(describeChatTurn()).toEqual({ prompt: null, reply: null, model: null })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/history/recorder.test.ts`
Expected: FAIL with "Failed to resolve import './recorder'".

- [ ] **Step 3: Write minimal implementation**

`src/history/recorder.ts`:

```ts
import { useChatStore } from '../chat/chatStore'
import { putBlob } from '../db/blobs'
import type { Version } from '../db/db'
import { paramsEqual, type Params } from '../render/params'
import { effectiveValues, paramOverrides } from '../scad/customizer'
import { useAppStore, type AppState, type CodeSource } from '../state/store'
import { matchesHead } from './matchesHead'
import { bakeMessage, describeParamChanges, manualMessage, truncate } from './messages'
import { useProjectStore, type CommitInput } from './projectStore'

export const IDLE_COMMIT_MS = 30_000

export interface TurnInfo {
  prompt: string | null
  reply: string | null
  model: string | null
}

export interface RecorderDeps {
  idleMs?: number
  capture?(): Promise<Blob | null>
  describeTurn?(): TurnInfo
  onCommit?(version: Version): void | Promise<void>
}

export interface Recorder {
  /** Commits a pending manual or slider change now (editor blur, before the head moves). */
  flush(): Promise<void>
  /** Resolves once every queued commit and patch has been written. */
  settled(): Promise<void>
  stop(): void
}

/** Code changes from these sources become a version at once; manual edits and parameter changes are coalesced. */
const IMMEDIATE: ReadonlySet<CodeSource> = new Set(['ai', 'autofix', 'restore', 'gallery', 'import', 'slider'])

interface Snapshot {
  code: string
  params: Params
}

/** Changes not processed yet: the state before the first one, and the source of the last code change. */
interface Pending {
  prev: Snapshot
  source: CodeSource
}

export function describeChatTurn(): TurnInfo {
  const messages = useChatStore.getState().messages
  let prompt: string | null = null
  let reply: string | null = null
  let model: string | null = null
  for (let i = messages.length - 1; i >= 0 && (prompt === null || reply === null); i--) {
    const m = messages[i]!
    if (m.role === 'user' && prompt === null) prompt = m.text
    if (m.role === 'assistant' && reply === null && prompt === null) {
      reply = m.text
      model = m.model
    }
  }
  return { prompt, reply, model }
}

let active: Recorder | null = null

/** Commits the running recorder's pending edit; the code editor calls it on blur. */
export function flushRecorder(): void {
  void active?.flush()
}

export function startRecorder(deps: RecorderDeps = {}): Recorder {
  const idleMs = deps.idleMs ?? IDLE_COMMIT_MS
  const capture = deps.capture ?? (async () => null)
  const describeTurn = deps.describeTurn ?? describeChatTurn

  let dirty: 'manual' | 'slider' | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let pending: Pending | null = null
  let queue: Promise<void> = Promise.resolve()

  const serial = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((e: unknown) => console.error('Recording a version failed', e))
    return queue
  }

  const clearDirty = () => {
    dirty = null
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = null
  }

  const restartIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      void recorder.flush()
    }, idleMs)
  }

  function statusFor(s: AppState, snap: Snapshot): Pick<Version, 'compileStatus' | 'renderMs'> {
    const lr = s.lastRender
    if (!lr || lr.code !== snap.code) return { compileStatus: 'pending', renderMs: null }
    if (!lr.result.ok) return { compileStatus: 'error', renderMs: lr.result.renderMs }
    return paramsEqual(s.renderedParams, snap.params) ? { compileStatus: 'ok', renderMs: lr.result.renderMs } : { compileStatus: 'pending', renderMs: null }
  }

  async function attachThumbnail(version: Version): Promise<void> {
    const blob = await capture()
    if (!blob) return
    const id = await putBlob('thumbnail', blob)
    await useProjectStore.getState().patchVersion(version.id, { thumbnailBlobId: id })
  }

  async function record(input: CommitInput): Promise<void> {
    const version = await useProjectStore.getState().commit(input)
    if (version.compileStatus === 'ok') await attachThumbnail(version)
    await deps.onCommit?.(version)
  }

  async function commitDirty(snap: Snapshot, s: AppState): Promise<void> {
    const kind = dirty
    const head = useProjectStore.getState().head
    clearDirty()
    if (!kind || !head || matchesHead(snap.code, snap.params, head)) return
    const message =
      kind === 'manual' && snap.code !== head.code
        ? manualMessage(head.code, snap.code)
        : describeParamChanges(effectiveValues(head.code, head.params), effectiveValues(snap.code, snap.params))
    await record({
      code: snap.code,
      params: paramOverrides(snap.code, snap.params),
      source: kind,
      message,
      model: null,
      ...statusFor(s, snap),
    })
  }

  async function commitImmediate(s: AppState, prev: Snapshot, source: CodeSource): Promise<void> {
    const head = useProjectStore.getState().head
    if (!head) return
    const params = paramOverrides(s.code, s.params)
    let message: string
    let model: string | null = null
    switch (source) {
      case 'ai': {
        const t = describeTurn()
        message = truncate(t.prompt ?? '') || 'AI edit'
        model = t.model
        break
      }
      case 'autofix': {
        const t = describeTurn()
        const reply = truncate(t.reply ?? '')
        message = reply ? `Auto-fix: ${reply}` : 'Auto-fix'
        model = t.model
        break
      }
      case 'slider':
        message = bakeMessage(Object.keys(paramOverrides(prev.code, prev.params)))
        break
      case 'restore': {
        const match = useProjectStore.getState().versions.find((v) => v.code === s.code && paramsEqual(v.params, params))
        message = match ? `Restored ${match.label}` : 'Restored earlier code'
        break
      }
      case 'gallery':
        message = 'Started from an example'
        break
      case 'import':
        message = 'Imported code'
        break
      case 'manual':
        message = manualMessage(head.code, s.code)
        break
    }
    await record({ code: s.code, params, source, message, model, ...statusFor(s, { code: s.code, params: s.params }) })
  }

  async function processEdit({ prev, source }: Pending): Promise<void> {
    const s = useAppStore.getState()
    const head = useProjectStore.getState().head
    if (!head) return
    if (matchesHead(s.code, s.params, head)) {
      clearDirty()
      return
    }
    const codeChanged = s.code !== prev.code
    if (codeChanged && IMMEDIATE.has(source)) {
      if (dirty === 'slider' && source === 'slider') clearDirty()
      if (dirty) await commitDirty(prev, s)
      await commitImmediate(useAppStore.getState(), prev, source)
      return
    }
    dirty = codeChanged ? 'manual' : (dirty ?? 'slider')
    restartIdle()
  }

  async function onRendered(): Promise<void> {
    const s = useAppStore.getState()
    const lr = s.lastRender
    if (!lr || lr.code !== s.code) return
    if (lr.result.ok && !paramsEqual(s.renderedParams, s.params)) return
    if (dirty) {
      if (lr.result.ok) await commitDirty({ code: s.code, params: s.params }, s)
      return
    }
    const head = useProjectStore.getState().head
    if (head && head.compileStatus === 'pending' && matchesHead(s.code, s.params, head)) {
      await useProjectStore.getState().patchVersion(head.id, {
        compileStatus: lr.result.ok ? 'ok' : 'error',
        renderMs: lr.result.renderMs,
      })
      if (lr.result.ok) await attachThumbnail(head)
    }
  }

  const takePending = (): Pending | null => {
    const p = pending
    pending = null
    return p
  }

  const unsubscribe = useAppStore.subscribe((s, prev) => {
    const codeChanged = s.code !== prev.code
    if (codeChanged || s.params !== prev.params) {
      // Several synchronous updates (setCode then setParams) are handled as one change.
      if (pending === null) {
        pending = { prev: { code: prev.code, params: prev.params }, source: s.codeSource }
        queueMicrotask(() => {
          const p = takePending()
          if (p) void serial(() => processEdit(p))
        })
      }
      // The source is taken when the code changes, so a later echo of the same code cannot relabel it.
      if (codeChanged) pending.source = s.codeSource
    }
    if (s.lastRender !== prev.lastRender) void serial(onRendered)
  })

  const recorder: Recorder = {
    flush: () => {
      // An edit made in this same task has not been processed yet; take it now so it is not lost.
      const p = takePending()
      return serial(async () => {
        if (p) await processEdit(p)
        if (!dirty) return
        const s = useAppStore.getState()
        await commitDirty({ code: s.code, params: s.params }, s)
      })
    },
    async settled() {
      let seen: Promise<void>
      do {
        await Promise.resolve()
        seen = queue
        await seen
      } while (seen !== queue)
    },
    stop() {
      unsubscribe()
      clearDirty()
      if (active === recorder) active = null
    },
  }
  active = recorder
  return recorder
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/history/recorder.test.ts && npm run typecheck`
Expected: PASS (13 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/history/recorder.ts src/history/recorder.test.ts
git commit -m "feat(history): record AI, slider, restore and coalesced manual changes as versions with thumbnails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Chat persistence, usage links, project cost and the composer bridge

**Files:**
- Create: `src/db/usageLinks.ts`, `src/history/chatPersistence.ts`, `src/history/projectCost.ts`, `src/chat/ProjectCostCaption.tsx`, `src/chat/promptRequest.ts`, `src/ai/libraryPrompt.ts`
- Modify (M2 files, described against the contracts): the chat pane head that shows "… this chat"; `src/ai/prompt.ts` (`buildSystemPrompt`) if it ignores `PromptContext.libraries`; the place that builds the `PromptContext` for `runTurn`
- Test: `src/db/usageLinks.test.ts`, `src/history/chatPersistence.test.ts`, `src/chat/promptRequest.test.tsx`

**Interfaces:**
- Consumes: `useChatStore`, `ChatMessage` (M2; assumed hook name, see "Contract issues"); `db.usage` (Task 6); `putMessage`, `listMessages` (Task 6); `useProjectStore`, `currentLibraries` (Task 9); `formatCost` (M2); `LIBRARY_INFO`, `isLibraryName` (Task 4); `PromptContext`, `buildSystemPrompt` (M2 contract).
- Produces:
  - `src/db/usageLinks.ts`: `installUsageHook(getProjectId: () => string | null): () => void` (a Dexie `creating` hook on `usage`: fills a null `projectId` with the open project and remembers the new row's id; returns the uninstaller), `takePendingUsageIds(): string[]`, `clearPendingUsage(): void`, `linkUsage(ids: string[], versionId: string): Promise<void>`, `usageByIds(ids: string[]): Promise<UsageRecord[]>`, `usageForVersion(versionId: string): Promise<UsageRecord[]>`. M2's usage writer is untouched.
  - `src/history/chatPersistence.ts`: `toStored(m: ChatMessage, meta: { projectId: string; versionId: string | null; usageId: string | null; createdAt: number }): StoredMessage`; `fromStored(m: StoredMessage, version: Version | undefined, usage: UsageRecord | undefined): ChatMessage`; `interface ChatPersistence { linkTurn(version: Version): Promise<void>; load(projectId: string): Promise<void>; settled(): Promise<void>; stop(): void }`; `startChatPersistence(): ChatPersistence`. Finished messages (`status` not `'streaming'`) of the open project are written as `StoredMessage` rows; `linkTurn` ties every not-yet-linked message to the version, gives the turn's last assistant message `turnLabel = version.label` (and keeps it, even if M2 later rewrites the message), and links the turn's usage rows; `load` replaces the chat with the project's stored messages.
  - `src/history/projectCost.ts`: `projectCost(messages: ChatMessage[]): number`.
  - `src/chat/ProjectCostCaption.tsx`: `ProjectCostCaption()` → "$0.026 this project" (`pc-caption pc-mono`).
  - `src/chat/promptRequest.ts`: `ANNOTATE_PROMPT`, `ADD_PARAMETERS_PROMPT`; `usePromptRequest` (Zustand `{ request: { text: string; id: number } | null; ask(text: string): void; clear(): void }`); `fillComposer(text: string, root?: ParentNode): boolean` (sets the `textarea[aria-label="Prompt"]` value through the native setter and dispatches `input`, so React's controlled state updates; focuses it); `ComposerBridge()` (renders nothing; applies a pending request once the composer exists). The person reviews the text and sends it; nothing is sent automatically, because every request costs money.
  - `src/ai/libraryPrompt.ts`: `librarySection(libraries: string[]): string` (empty for none).

- [ ] **Step 1: Write the failing tests**

`src/db/usageLinks.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { resetDb } from '../test/resetDb'
import { db, type UsageRecord } from './db'
import { installUsageHook, linkUsage, takePendingUsageIds, usageByIds, usageForVersion } from './usageLinks'

const row = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  id: crypto.randomUUID(),
  profileId: 'p',
  model: 'm',
  inputTokens: 100,
  outputTokens: 20,
  cost: 0.001,
  costSource: 'provider',
  createdAt: 1,
  projectId: null,
  versionId: null,
  ...over,
})

beforeEach(resetDb)

it('tags new usage rows with the open project and links them to a version later', async () => {
  let project: string | null = 'proj-1'
  const uninstall = installUsageHook(() => project)
  const a = row()
  const b = row({ projectId: 'explicit' })
  await db.usage.add(a)
  await db.usage.add(b)
  expect((await db.usage.get(a.id))?.projectId).toBe('proj-1')
  expect((await db.usage.get(b.id))?.projectId).toBe('explicit')

  const ids = takePendingUsageIds()
  expect(ids).toEqual([a.id, b.id])
  expect(takePendingUsageIds()).toEqual([])
  await linkUsage(ids, 'v9')
  expect((await usageForVersion('v9')).map((u) => u.id).sort()).toEqual([a.id, b.id].sort())
  expect((await usageByIds([a.id, 'missing'])).map((u) => u.id)).toEqual([a.id])

  uninstall()
  project = 'proj-2'
  const c = row()
  await db.usage.add(c)
  expect((await db.usage.get(c.id))?.projectId).toBeNull()
  expect(takePendingUsageIds()).toEqual([])
})
```

`src/history/chatPersistence.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { useChatStore, type ChatMessage } from '../chat/chatStore'
import { db, type UsageRecord } from '../db/db'
import { installUsageHook } from '../db/usageLinks'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { startChatPersistence, type ChatPersistence } from './chatPersistence'
import { projectCost } from './projectCost'
import { useProjectStore } from './projectStore'

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  text: 'hi',
  turnLabel: null,
  model: null,
  usage: null,
  status: 'done',
  ...over,
})

const usage = (id: string): UsageRecord => ({
  id, profileId: 'p', model: 'gpt-x', inputTokens: 1000, outputTokens: 180, cost: 0.006, costSource: 'provider', createdAt: 5, projectId: null, versionId: null,
})

let chat: ChatPersistence
let uninstall: () => void
const store = () => useProjectStore.getState()

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useChatStore.setState({ messages: [] })
  uninstall = installUsageHook(() => store().project?.id ?? null)
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  chat = startChatPersistence()
})
afterEach(() => {
  chat.stop()
  uninstall()
})

it('stores finished messages of the open project and skips streaming ones', async () => {
  const user = msg({ text: 'A holder for four cells' })
  const reply = msg({ role: 'assistant', text: 'Made…', status: 'streaming' })
  useChatStore.setState({ messages: [user, reply] })
  await chat.settled()
  expect((await db.messages.toArray()).map((m) => [m.role, m.content, m.projectId])).toEqual([['user', 'A holder for four cells', store().project!.id]])
})

it('links a turn to its version: label on the last reply, version on every message, usage on the reply', async () => {
  const user = msg({ text: 'Taller please' })
  const reply = msg({ role: 'assistant', text: 'Raised it.', model: 'gpt-x', status: 'streaming' })
  useChatStore.setState({ messages: [user, reply] })
  await db.usage.add(usage('u1'))
  const v2 = await store().commit({ code: 'cube(2);', params: {}, source: 'ai', message: 'Taller please', model: 'gpt-x', compileStatus: 'pending', renderMs: null })
  await chat.linkTurn(v2)

  // M2 finishes the message and (in M2's own logic) resets the label; M3's label wins.
  useChatStore.setState((s) => ({ messages: s.messages.map((m) => (m.id === reply.id ? { ...m, status: 'done', turnLabel: null } : m)) }))
  await chat.settled()

  expect(useChatStore.getState().messages.find((m) => m.id === reply.id)?.turnLabel).toBe('v2')
  const rows = await db.messages.orderBy('createdAt').toArray()
  expect(rows.map((r) => [r.role, r.versionId, r.usageId])).toEqual([
    ['user', v2.id, null],
    ['assistant', v2.id, 'u1'],
  ])
  expect(await db.usage.get('u1')).toMatchObject({ projectId: store().project!.id, versionId: v2.id })
})

it('loads a project chat with labels, usage and compile status, and swaps chats between projects', async () => {
  const first = store().project!
  const reply = msg({ role: 'assistant', text: 'Made a box.', model: 'gpt-x' })
  useChatStore.setState({ messages: [msg({ text: 'A box' }), reply] })
  await db.usage.add(usage('u1'))
  const v2 = await store().commit({ code: 'cube(2);', params: {}, source: 'ai', message: 'A box', model: 'gpt-x', compileStatus: 'error', renderMs: 3 })
  await chat.linkTurn(v2)
  await chat.settled()

  await store().newProject({ code: 'sphere(1);', origin: 'blank' })
  await chat.load(store().project!.id)
  expect(useChatStore.getState().messages).toEqual([])

  await store().openProject(first.id)
  await chat.load(first.id)
  const loaded = useChatStore.getState().messages
  expect(loaded.map((m) => [m.role, m.text, m.turnLabel, m.status])).toEqual([
    ['user', 'A box', null, 'done'],
    ['assistant', 'Made a box.', 'v2', 'done'],
  ])
  expect(loaded[1]).toMatchObject({ model: 'gpt-x', usage: { inputTokens: 1000, outputTokens: 180, cost: 0.006 }, compileStatus: 'error' })
  expect(projectCost(loaded)).toBeCloseTo(0.006)
  await chat.settled()
  expect(await db.messages.count()).toBe(2)
})

it('writes nothing while no project is open', async () => {
  useProjectStore.setState({ project: null, head: null, versions: [] })
  useChatStore.setState({ messages: [msg({})] })
  await chat.settled()
  expect(await db.messages.count()).toBe(0)
})
```

`src/chat/promptRequest.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { librarySection } from '../ai/libraryPrompt'
import { useChatStore, type ChatMessage } from './chatStore'
import { ProjectCostCaption } from './ProjectCostCaption'
import { ComposerBridge, fillComposer, usePromptRequest } from './promptRequest'

function Composer() {
  const [text, setText] = useState('')
  return (
    <>
      <textarea aria-label="Prompt" value={text} onChange={(e) => setText(e.target.value)} />
      <output data-testid="state">{text}</output>
    </>
  )
}

beforeEach(() => usePromptRequest.setState({ request: null }))

it('fills a controlled composer so React state follows, and focuses it', () => {
  render(<Composer />)
  expect(fillComposer('Add annotations')).toBe(true)
  expect(screen.getByTestId('state')).toHaveTextContent('Add annotations')
  expect(screen.getByLabelText('Prompt')).toHaveFocus()
})

it('reports when there is no composer to fill', () => {
  expect(fillComposer('x', document.createElement('div'))).toBe(false)
})

it('applies a requested prompt once the composer is on screen, then clears the request', () => {
  const { rerender } = render(<ComposerBridge />)
  act(() => usePromptRequest.getState().ask('Add annotations'))
  expect(usePromptRequest.getState().request?.text).toBe('Add annotations')
  rerender(
    <>
      <ComposerBridge />
      <Composer />
    </>,
  )
  act(() => usePromptRequest.getState().ask('Add annotations, please'))
  expect(screen.getByTestId('state')).toHaveTextContent('Add annotations, please')
  expect(usePromptRequest.getState().request).toBeNull()
})

it('shows the project cost from the loaded chat', () => {
  const m = (cost: number | null): ChatMessage => ({
    id: crypto.randomUUID(), role: 'assistant', text: '', turnLabel: null, model: null, status: 'done',
    usage: { inputTokens: 1, outputTokens: 1, cost },
  })
  useChatStore.setState({ messages: [m(0.011), m(0.006), m(null)] })
  render(<ProjectCostCaption />)
  expect(screen.getByTestId('project-cost')).toHaveTextContent('$0.017 this project')
})

it('tells the model which libraries it may use, and nothing when none are enabled', () => {
  expect(librarySection([])).toBe('')
  const text = librarySection(['BOSL2', 'MCAD', 'bogus'])
  expect(text).toContain('include <BOSL2/std.scad>')
  expect(text).toContain('use <MCAD/boxes.scad>')
  expect(text).not.toContain('bogus')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/usageLinks.test.ts src/history/chatPersistence.test.ts src/chat/promptRequest.test.tsx`
Expected: FAIL with "Failed to resolve import './usageLinks'", "… './chatPersistence'", "… '../ai/libraryPrompt'".

- [ ] **Step 3: Write minimal implementation**

`src/db/usageLinks.ts`:

```ts
import { db, type UsageRecord } from './db'

let pending: string[] = []

/**
 * M2 writes usage rows with projectId null. This hook fills in the open project and remembers each new row,
 * so the version recorded for the turn can claim it (linkUsage).
 */
export function installUsageHook(getProjectId: () => string | null): () => void {
  const hook = (_primKey: unknown, obj: UsageRecord): void => {
    if (obj.projectId === null) obj.projectId = getProjectId()
    pending.push(obj.id)
  }
  db.usage.hook('creating', hook)
  return () => {
    db.usage.hook('creating').unsubscribe(hook)
    pending = []
  }
}

export function takePendingUsageIds(): string[] {
  const ids = pending
  pending = []
  return ids
}

export function clearPendingUsage(): void {
  pending = []
}

export async function linkUsage(ids: string[], versionId: string): Promise<void> {
  if (ids.length > 0) await db.usage.where(':id').anyOf(ids).modify({ versionId })
}

export async function usageByIds(ids: string[]): Promise<UsageRecord[]> {
  return (await db.usage.bulkGet(ids)).filter((u): u is UsageRecord => u !== undefined)
}

export const usageForVersion = (versionId: string): Promise<UsageRecord[]> => db.usage.where('versionId').equals(versionId).toArray()
```

`src/history/projectCost.ts`:

```ts
import type { ChatMessage } from '../chat/chatStore'

/** Sum of the known costs in the project's chat (unknown prices count as nothing). */
export function projectCost(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.usage?.cost ?? 0), 0)
}
```

`src/history/chatPersistence.ts`:

```ts
import { useChatStore, type ChatMessage } from '../chat/chatStore'
import type { StoredMessage, UsageRecord, Version } from '../db/db'
import { listMessages, putMessage } from '../db/messages'
import { clearPendingUsage, linkUsage, takePendingUsageIds, usageByIds } from '../db/usageLinks'
import { useProjectStore } from './projectStore'

export interface ChatPersistence {
  linkTurn(version: Version): Promise<void>
  load(projectId: string): Promise<void>
  settled(): Promise<void>
  stop(): void
}

export function toStored(
  m: ChatMessage,
  meta: { projectId: string; versionId: string | null; usageId: string | null; createdAt: number },
): StoredMessage {
  return {
    id: m.id,
    projectId: meta.projectId,
    versionId: meta.versionId,
    role: m.role,
    content: m.text,
    imageBlobIds: m.imageBlobIds ?? [],
    audioTranscript: null,
    model: m.model,
    usageId: meta.usageId,
    createdAt: meta.createdAt,
  }
}

/** `version` is passed only for the message that carries the turn's label. */
export function fromStored(m: StoredMessage, version: Version | undefined, usage: UsageRecord | undefined): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    text: m.content,
    turnLabel: version?.label ?? null,
    model: m.model,
    usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost } : null,
    status: 'done',
    ...(version && version.compileStatus !== 'pending' ? { compileStatus: version.compileStatus } : {}),
    ...(m.imageBlobIds.length > 0 ? { imageBlobIds: m.imageBlobIds } : {}),
  }
}

export function startChatPersistence(): ChatPersistence {
  const versionOf = new Map<string, string>() // message id → version id
  const labelOf = new Map<string, string>() // message id → version label (the turn's last reply)
  const usageOf = new Map<string, string>() // message id → usage id
  const createdAtOf = new Map<string, number>()
  const persisted = new Map<string, ChatMessage>() // last object written per id
  let lastTime = 0
  let loading = false
  let queue: Promise<void> = Promise.resolve()

  const serial = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((e: unknown) => console.error('Saving the chat failed', e))
    return queue
  }
  const nextTime = () => (lastTime = Math.max(Date.now(), lastTime + 1))

  function enforceLabels(messages: ChatMessage[]): void {
    if (!messages.some((m) => labelOf.has(m.id) && m.turnLabel !== labelOf.get(m.id))) return
    useChatStore.setState({
      messages: messages.map((m) => (labelOf.has(m.id) && m.turnLabel !== labelOf.get(m.id) ? { ...m, turnLabel: labelOf.get(m.id)! } : m)),
    })
  }

  function persistChanged(messages: ChatMessage[]): void {
    const projectId = useProjectStore.getState().project?.id
    if (!projectId || loading) return
    for (const m of messages) {
      if (!createdAtOf.has(m.id)) createdAtOf.set(m.id, nextTime())
      if (m.status === 'streaming' || persisted.get(m.id) === m) continue
      persisted.set(m.id, m)
      const row = toStored(m, {
        projectId,
        versionId: versionOf.get(m.id) ?? null,
        usageId: usageOf.get(m.id) ?? null,
        createdAt: createdAtOf.get(m.id)!,
      })
      void serial(() => putMessage(row))
    }
  }

  const unsubscribe = useChatStore.subscribe((s) => {
    enforceLabels(s.messages)
    persistChanged(useChatStore.getState().messages)
  })

  const persistence: ChatPersistence = {
    async linkTurn(version) {
      const unlinked = useChatStore.getState().messages.filter((m) => !versionOf.has(m.id))
      const usageIds = takePendingUsageIds()
      for (const m of unlinked) {
        versionOf.set(m.id, version.id)
        persisted.delete(m.id)
      }
      const reply = [...unlinked].reverse().find((m) => m.role === 'assistant')
      if (reply) {
        labelOf.set(reply.id, version.label)
        if (usageIds.length > 0) usageOf.set(reply.id, usageIds.at(-1)!)
      }
      await serial(() => linkUsage(usageIds, version.id))
      enforceLabels(useChatStore.getState().messages)
      persistChanged(useChatStore.getState().messages)
      await persistence.settled()
    },

    async load(projectId) {
      await persistence.settled()
      loading = true
      try {
        const rows = await listMessages(projectId)
        const versions = new Map(useProjectStore.getState().versions.map((v) => [v.id, v]))
        const usage = new Map((await usageByIds(rows.flatMap((r) => (r.usageId ? [r.usageId] : [])))).map((u) => [u.id, u]))
        const lastReplyOf = new Map<string, string>()
        for (const r of rows) if (r.role === 'assistant' && r.versionId) lastReplyOf.set(r.versionId, r.id)
        for (const map of [versionOf, labelOf, usageOf, createdAtOf, persisted]) map.clear()
        clearPendingUsage()
        const messages = rows.map((r) => {
          const version = r.versionId ? versions.get(r.versionId) : undefined
          const labelled = version !== undefined && lastReplyOf.get(version.id) === r.id
          if (r.versionId) versionOf.set(r.id, r.versionId)
          if (r.usageId) usageOf.set(r.id, r.usageId)
          if (labelled) labelOf.set(r.id, version.label)
          createdAtOf.set(r.id, r.createdAt)
          const m = fromStored(r, labelled ? version : undefined, r.usageId ? usage.get(r.usageId) : undefined)
          persisted.set(m.id, m)
          return m
        })
        useChatStore.setState({ messages })
      } finally {
        loading = false
      }
    },

    async settled() {
      let seen: Promise<void>
      do {
        seen = queue
        await seen
      } while (seen !== queue)
    },

    stop() {
      unsubscribe()
    },
  }
  return persistence
}
```

`src/chat/ProjectCostCaption.tsx`:

```tsx
import { projectCost } from '../history/projectCost'
import { formatCost } from '../ui/format'
import { useChatStore } from './chatStore'

/** "$0.026 this project" in the chat pane head (screen Main); replaces M2's "this chat" caption. */
export function ProjectCostCaption() {
  const cost = useChatStore((s) => projectCost(s.messages))
  return (
    <span className="pc-caption pc-mono" data-testid="project-cost">
      {formatCost(cost)} this project
    </span>
  )
}
```

`src/chat/promptRequest.ts`:

```ts
import { useEffect } from 'react'
import { create } from 'zustand'

export const ANNOTATE_PROMPT =
  'Add OpenSCAD Customizer annotations to every top-level parameter: a range comment such as // [10:1:200] for numbers, a list of options for choices, a one-line description on the line above each, and /* [Group] */ tabs where they help. Do not change any value or the geometry.'

export const ADD_PARAMETERS_PROMPT =
  'Make this model parametric: move every tunable dimension into a top-level variable before the first module, in millimetres, with an OpenSCAD Customizer range comment and a one-line description. Do not change the geometry.'

export interface PromptRequestState {
  request: { text: string; id: number } | null
  ask(text: string): void
  clear(): void
}

let nextId = 0

export const usePromptRequest = create<PromptRequestState>()((set) => ({
  request: null,
  ask: (text) => set({ request: { text, id: ++nextId } }),
  clear: () => set({ request: null }),
}))

/**
 * Puts text into the chat composer (screen Main: textarea "Prompt") through the native value setter, so the
 * composer's React state follows. The person reviews it and presses Send; nothing is sent from here.
 */
export function fillComposer(text: string, root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')
  if (!el) return false
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
  return true
}

/** Mounted once in the App: applies a pending request as soon as the composer exists. */
export function ComposerBridge() {
  const request = usePromptRequest((s) => s.request)
  useEffect(() => {
    if (request && fillComposer(request.text)) usePromptRequest.getState().clear()
  })
  return null
}
```

`src/ai/libraryPrompt.ts`:

```ts
import { isLibraryName, LIBRARY_INFO } from '../render/libraries'

/** The system prompt mentions a library only when the project enables it (D8). */
export function librarySection(libraries: string[]): string {
  const enabled = libraries.filter(isLibraryName)
  if (enabled.length === 0) return ''
  const lines = enabled.map((name) => `- ${name} ${LIBRARY_INFO[name].version}: ${LIBRARY_INFO[name].usage}`)
  return `Libraries available in this project (use no others):\n${lines.join('\n')}`
}
```

M2 changes (described against the contracts; keep everything else in those files):

1. Chat pane head: where M2 renders the "`<cost>` this chat" caption next to the "Chat" label, render `<ProjectCostCaption />` instead (import from `src/chat/ProjectCostCaption`).
2. `src/ai/prompt.ts`: `buildSystemPrompt(ctx)` must end with the library section. If M2 did not already use `ctx.libraries`, change its return to append it:

```ts
import { librarySection } from './libraryPrompt'

export function buildSystemPrompt(ctx: PromptContext): string {
  const libraries = librarySection(ctx.libraries ?? [])
  return libraries ? `${SYSTEM_PROMPT}\n\n${libraries}` : SYSTEM_PROMPT
}
```

   If M2's `buildSystemPrompt` already adds other context (errors, selection), keep that and append `libraries` the same way. Add this test to M2's `src/ai/prompt.test.ts`:

```ts
it('mentions only the enabled libraries', () => {
  expect(buildSystemPrompt({ code: '', libraries: ['BOSL2'] })).toContain('include <BOSL2/std.scad>')
  expect(buildSystemPrompt({ code: '' })).not.toContain('BOSL2')
})
```

3. Where M2 builds the `PromptContext` it passes to `runTurn` (contract `ctx`), add the project's libraries: `libraries: currentLibraries()` (import from `src/history/projectStore`), keeping M2's other fields.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db/usageLinks.test.ts src/history/chatPersistence.test.ts src/chat src/ai && npm run typecheck`
Expected: PASS (1 + 4 + 5 new tests, the new prompt test, and M2's chat and AI tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/usageLinks.ts src/db/usageLinks.test.ts src/history/chatPersistence.ts src/history/chatPersistence.test.ts src/history/projectCost.ts src/chat src/ai
git commit -m "feat(history): persist chat per project, link turns and usage to versions, show project cost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Customizer parameter rows

**Files:**
- Create: `src/customizer/units.ts`, `src/customizer/ParamRow.tsx`
- Test: `src/customizer/ParamRow.test.tsx`

**Interfaces:**
- Consumes: `CustomizerParam`, `ParamControl` (Task 2); `paramValueEqual` (Task 2); `formatValue` (Task 8).
- Produces:
  - `unitFor(param: CustomizerParam): string`: an explicit unit in the description wins ("(mm)", "(degrees)" → `°`, "(%)"); otherwise `°` for angles, nothing for counts (`teeth`, `slots`, `holes_per_leg`, `cable_count`, "Number of …"), else `mm` (spec: "millimetres").
  - `ParamRow({ param, value, onChange }: { param: CustomizerParam; value: ParamValue; onChange(value: ParamValue): void })`: one `pc-param` row; `is-changed` when `value` differs from the default; the description is the row's tooltip.
    - slider: name with `<small>[min : step : max]</small>`, `pc-range` (`aria-label` = name), and a mono value field (`aria-label` "name value") with `pc-unit`;
    - number: the value field across both control columns; hint "step 0.5" when the annotation gives one;
    - dropdown: `pc-select` with the labels; picks the option's typed value;
    - toggle: `pc-switch`; text: `pc-input`; vector: one mono field per axis (`aria-label` "size x", "size y", …).
  - Number fields keep a text draft: a valid number is applied as you type; anything else marks the field `is-invalid` and changes nothing; leaving the field restores the current value.

- [ ] **Step 1: Write the failing test**

`src/customizer/ParamRow.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import type { CustomizerParam } from '../scad/customizer'
import { ParamRow } from './ParamRow'
import { unitFor } from './units'

const param = (over: Partial<CustomizerParam>): CustomizerParam => ({
  name: 'width',
  defaultValue: 40,
  control: { kind: 'slider', min: 10, step: 1, max: 200 },
  group: '',
  description: '',
  line: 1,
  annotated: true,
  ...over,
})

it('renders a slider row with the range hint, the value field and the mm unit', () => {
  const onChange = vi.fn()
  render(<ParamRow param={param({ description: 'Outer width' })} value={40} onChange={onChange} />)
  const row = screen.getByTestId('param-width')
  expect(row).toHaveClass('pc-param')
  expect(row).not.toHaveClass('is-changed')
  expect(row).toHaveAttribute('title', 'Outer width')
  expect(row).toHaveTextContent('width[10 : 1 : 200]')
  const range = screen.getByRole('slider', { name: 'width' })
  expect(range).toHaveAttribute('min', '10')
  expect(range).toHaveAttribute('max', '200')
  expect(range).toHaveAttribute('step', '1')
  expect(screen.getByLabelText('width value')).toHaveValue('40')
  expect(row.querySelector('.pc-unit')).toHaveTextContent('mm')

  fireEvent.change(range, { target: { value: '55' } })
  expect(onChange).toHaveBeenCalledWith(55)
})

it('marks a changed value with is-changed', () => {
  render(<ParamRow param={param({})} value={41} onChange={() => {}} />)
  expect(screen.getByTestId('param-width')).toHaveClass('is-changed')
})

it('applies valid typed numbers, flags invalid ones, and restores the value on blur', () => {
  const onChange = vi.fn()
  render(<ParamRow param={param({ control: { kind: 'number', step: 0.5 }, annotated: true })} value={40} onChange={onChange} />)
  expect(screen.getByTestId('param-width')).toHaveTextContent('step 0.5')
  const field = screen.getByLabelText('width')
  fireEvent.change(field, { target: { value: '12.5' } })
  expect(onChange).toHaveBeenLastCalledWith(12.5)
  fireEvent.change(field, { target: { value: '12,5x' } })
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(field.closest('.pc-input')).toHaveClass('is-invalid')
  expect(field).toHaveAttribute('aria-invalid', 'true')
  fireEvent.blur(field)
  expect(field).toHaveValue('40')
})

it('picks typed values from dropdowns', () => {
  const onChange = vi.fn()
  const options = [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }]
  render(<ParamRow param={param({ name: 'teeth', defaultValue: 1, control: { kind: 'dropdown', options } })} value={1} onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'teeth' }), { target: { value: '1' } })
  expect(onChange).toHaveBeenCalledWith(2)
})

it('shows a value that is not among the options instead of picking the first one', () => {
  const options = [{ value: 'round', label: 'round' }]
  render(<ParamRow param={param({ name: 'shape', defaultValue: 'round', control: { kind: 'dropdown', options } })} value="hex" onChange={() => {}} />)
  expect(screen.getByRole('combobox', { name: 'shape' })).toHaveDisplayValue('hex')
})

it('renders toggle, text and vector controls', () => {
  const onChange = vi.fn()
  const { rerender } = render(<ParamRow param={param({ name: 'holes', defaultValue: true, control: { kind: 'toggle' } })} value={true} onChange={onChange} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'holes' }))
  expect(onChange).toHaveBeenLastCalledWith(false)

  rerender(<ParamRow param={param({ name: 'label', defaultValue: 'ABC', control: { kind: 'text' } })} value="ABC" onChange={onChange} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'label' }), { target: { value: '<b>XYZ</b>' } })
  expect(onChange).toHaveBeenLastCalledWith('<b>XYZ</b>')

  rerender(<ParamRow param={param({ name: 'size', defaultValue: [20, 30, 5], control: { kind: 'vector', length: 3 } })} value={[20, 30, 5]} onChange={onChange} />)
  expect(screen.getByLabelText('size x')).toHaveValue('20')
  fireEvent.change(screen.getByLabelText('size y'), { target: { value: '35' } })
  expect(onChange).toHaveBeenLastCalledWith([20, 35, 5])
})

it('picks units from the description, angles and counts', () => {
  expect(unitFor(param({ name: 'pressure_angle', description: 'Pressure angle (degrees)' }))).toBe('°')
  expect(unitFor(param({ name: 'angle' }))).toBe('°')
  expect(unitFor(param({ name: 'gear_module', description: 'Gear module: pitch diameter divided by teeth (mm)' }))).toBe('mm')
  for (const name of ['teeth', 'slots', 'holes_per_leg', 'cable_count', 'knuckles', 'grip_ridges', 'n']) expect(unitFor(param({ name }))).toBe('')
  expect(unitFor(param({ name: 'rows', description: 'Number of rows' }))).toBe('')
  expect(unitFor(param({ name: 'fill', description: 'Infill (%)' }))).toBe('%')
  expect(unitFor(param({ name: 'wall' }))).toBe('mm')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/customizer/ParamRow.test.tsx`
Expected: FAIL with "Failed to resolve import './ParamRow'".

- [ ] **Step 3: Write minimal implementation**

`src/customizer/units.ts`:

```ts
import type { CustomizerParam } from '../scad/customizer'

const COUNT = /(^n$|^n_|_n$|count|num|qty|teeth|slots|ridges|knuckles|holes|segments|sides|steps)/i

/** Unit shown next to a numeric parameter. Models are in millimetres unless the parameter says otherwise. */
export function unitFor(p: CustomizerParam): string {
  const explicit = /\((mm|°|deg|degrees|%)\)/i.exec(p.description)
  if (explicit) {
    const unit = explicit[1]!.toLowerCase()
    return unit.startsWith('deg') ? '°' : unit
  }
  if (/angle|_deg$|^deg/i.test(p.name) || /\bangle\b/i.test(p.description)) return '°'
  if (COUNT.test(p.name) || /\b(number|count) of\b/i.test(p.description)) return ''
  return 'mm'
}
```

`src/customizer/ParamRow.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { formatValue } from '../history/messages'
import { paramValueEqual } from '../render/params'
import type { ParamValue } from '../render/types'
import type { CustomizerParam } from '../scad/customizer'
import { unitFor } from './units'

const AXES = ['x', 'y', 'z', 'w']

function NumberField({
  label,
  value,
  unit,
  onCommit,
  className = '',
}: {
  label: string
  value: number
  unit: string
  onCommit(n: number): void
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const valid = draft.trim() !== '' && Number.isFinite(Number(draft))
  return (
    <div className={`pc-input is-mono${valid ? '' : ' is-invalid'} ${className}`.trim()}>
      <input
        aria-label={label}
        aria-invalid={!valid}
        inputMode="decimal"
        value={draft}
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          if (text.trim() !== '' && Number.isFinite(Number(text))) onCommit(Number(text))
        }}
        onBlur={() => setDraft(String(value))}
      />
      {unit && <span className="pc-unit">{unit}</span>}
    </div>
  )
}

interface Props {
  param: CustomizerParam
  value: ParamValue
  onChange(value: ParamValue): void
}

export function ParamRow({ param, value, onChange }: Props) {
  const c = param.control
  const changed = !paramValueEqual(value, param.defaultValue)
  const unit = c.kind === 'slider' || c.kind === 'number' ? unitFor(param) : ''
  const hint = c.kind === 'slider' ? `[${c.min} : ${c.step} : ${c.max}]` : c.kind === 'number' && c.step !== undefined ? `step ${c.step}` : null
  const num = typeof value === 'number' ? value : Number(param.defaultValue)

  let control: React.ReactNode
  switch (c.kind) {
    case 'slider':
      control = (
        <>
          <input
            className="pc-range"
            type="range"
            aria-label={param.name}
            min={c.min}
            max={c.max}
            step={c.step}
            value={num}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <NumberField label={`${param.name} value`} value={num} unit={unit} onCommit={onChange} />
        </>
      )
      break
    case 'number':
      control = <NumberField className="col-span-2" label={param.name} value={num} unit={unit} onCommit={onChange} />
      break
    case 'dropdown': {
      const index = c.options.findIndex((o) => o.value === value)
      control = (
        <select
          className="pc-select col-span-2"
          aria-label={param.name}
          value={index === -1 ? 'other' : String(index)}
          onChange={(e) => {
            const option = c.options[Number(e.target.value)]
            if (option) onChange(option.value)
          }}
        >
          {index === -1 && (
            <option value="other" disabled>
              {formatValue(value)}
            </option>
          )}
          {c.options.map((o, i) => (
            <option key={i} value={String(i)}>
              {o.label}
            </option>
          ))}
        </select>
      )
      break
    }
    case 'toggle':
      control = (
        <label className="pc-switch col-span-2">
          <input type="checkbox" aria-label={param.name} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="pc-track" />
        </label>
      )
      break
    case 'text':
      control = (
        <div className="pc-input col-span-2">
          <input aria-label={param.name} value={String(value)} onChange={(e) => onChange(e.target.value)} />
        </div>
      )
      break
    case 'vector': {
      const items = Array.isArray(value) ? value : (param.defaultValue as number[])
      control = (
        <div className="col-span-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${c.length}, minmax(0, 1fr))` }}>
          {items.map((n, i) => (
            <NumberField
              key={i}
              label={`${param.name} ${AXES[i] ?? i + 1}`}
              value={n}
              unit=""
              onCommit={(next) => onChange(items.map((old, k) => (k === i ? next : old)))}
            />
          ))}
        </div>
      )
      break
    }
  }

  return (
    <div className={`pc-param${changed ? ' is-changed' : ''}`} title={param.description || undefined} data-testid={`param-${param.name}`}>
      <div className="pc-param-name">
        {param.name}
        {hint && <small>{hint}</small>}
      </div>
      {control}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/customizer/ParamRow.test.tsx && npm run typecheck`
Expected: PASS (7 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/customizer/units.ts src/customizer/ParamRow.tsx src/customizer/ParamRow.test.tsx
git commit -m "feat(customizer): parameter rows for slider, number, dropdown, toggle, text and vector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Customizer dock with presets, Reset, Bake and Ask AI to annotate

**Files:**
- Create: `src/customizer/CustomizerDock.tsx`
- Modify: `src/ui/icons.ts`
- Test: `src/customizer/CustomizerDock.test.tsx`

**Interfaces:**
- Consumes: `parseCustomizer`, `effectiveValues`, `paramOverrides`, `bakeParams` (Task 2); `paramsEqual` (Task 2); `useAppStore` (`code`, `params`, `setParams`, `setCode`, Task 3); `useProjectStore` (`project`, Task 9); `listPresets`, `putPreset`, `deletePreset` (Task 6); `usePromptRequest`, `ANNOTATE_PROMPT`, `ADD_PARAMETERS_PROMPT` (Task 12); `ParamRow` (Task 13).
- Produces:
  - `CustomizerDock()`: `<section aria-label="Parameters">` under the viewer (screen Main): group tabs (`pc-tabs`, "Parameters" for the unnamed group), the preset select ("Preset: default", "Preset: <name>", "Preset: custom" when the values match no preset, "Save as preset…"), a "Delete preset" icon button when a saved preset is selected, Reset (ghost) and Bake into code; the active group's `ParamRow`s; "Ask AI to annotate" when a number has no annotation; with no parameters, one line "This model has no parameters yet." and "Ask AI to add parameters".
  - Reset → `setParams({})`. Bake into code → `setCode(bakeParams(code, overrides), 'slider')` then `setParams({})` in the same task (the recorder records one "Baked … into code" version). Presets store only the overrides.
  - `src/ui/icons.ts` gains the icons M3 uses (added here once): `IconTrash` (Trash2), `IconHistory` (History), `IconUndo` (Undo2), `IconRedo` (Redo2), `IconChevronDown` (ChevronDown), `IconAi` (Sparkles), `IconManual` (Pencil), `IconSlider` (SlidersHorizontal), `IconAutofix` (Wrench), `IconRestore` (RotateCcw), `IconGallery` (LayoutGrid), `IconImport` (Upload), `IconSearch` (Search), `IconBranch` (GitBranch), `IconPlus` (Plus), `IconLock` (Lock), `IconUnlock` (Unlock).

- [ ] **Step 1: Write the failing test**

`src/customizer/CustomizerDock.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preset } from '../db/db'
import { useProjectStore } from '../history/projectStore'
import { useAppStore } from '../state/store'
import { makeProject } from '../test/fixtures'
import { usePromptRequest, ANNOTATE_PROMPT } from '../chat/promptRequest'
import { CustomizerDock } from './CustomizerDock'

const presets: Preset[] = [{ id: 's1', projectId: 'p1', name: 'tall', params: { height: 40 } }]
vi.mock('../db/presets', () => ({
  listPresets: vi.fn(async () => presets),
  putPreset: vi.fn(async (p: Preset) => void presets.push(p)),
  deletePreset: vi.fn(async (id: string) => void presets.splice(presets.findIndex((p) => p.id === id), 1)),
}))
const presetsApi = await import('../db/presets')

const CODE = [
  '/* [Dimensions] */',
  'width = 20; // [5:1:100]',
  'height = 10; // [2:1:50]',
  '/* [Lid] */',
  'lid = true;',
  'gap = 0.2;',
  '/* [Hidden] */',
  'secret = 1;',
].join('\n')

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.getState().setCode(CODE)
  useProjectStore.setState({ project: makeProject({ id: 'p1' }) })
  usePromptRequest.setState({ request: null })
  presets.splice(1)
})

it('shows one tab per group and the active group parameters, never hidden ones', async () => {
  render(<CustomizerDock />)
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Dimensions', 'Lid'])
  expect(screen.getByRole('tab', { name: 'Dimensions' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('param-width')).toBeInTheDocument()
  expect(screen.queryByTestId('param-lid')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Lid' }))
  expect(screen.getByTestId('param-lid')).toBeInTheDocument()
  expect(screen.queryByTestId('param-secret')).toBeNull()
  await waitFor(() => expect(presetsApi.listPresets).toHaveBeenCalledWith('p1'))
})

it('updates the store parameters from a slider, then resets them', () => {
  render(<CustomizerDock />)
  expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  fireEvent.change(screen.getByRole('slider', { name: 'width' }), { target: { value: '30' } })
  expect(useAppStore.getState().params).toEqual({ width: 30 })
  expect(screen.getByTestId('param-width')).toHaveClass('is-changed')
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(useAppStore.getState().params).toEqual({})
})

it('bakes the changed values into the code as a slider change and clears the parameters', () => {
  useAppStore.getState().setParams({ width: 30, height: 10 })
  render(<CustomizerDock />)
  fireEvent.click(screen.getByRole('button', { name: 'Bake into code' }))
  const s = useAppStore.getState()
  expect(s.code).toContain('width = 30; // [5:1:100]')
  expect(s.code).toContain('height = 10; // [2:1:50]')
  expect(s.codeSource).toBe('slider')
  expect(s.params).toEqual({})
})

it('applies, saves and deletes presets', async () => {
  render(<CustomizerDock />)
  const select = screen.getByRole('combobox', { name: 'Preset' })
  await waitFor(() => expect(screen.getByRole('option', { name: 'Preset: tall' })).toBeInTheDocument())
  expect(select).toHaveDisplayValue('Preset: default')

  fireEvent.change(select, { target: { value: 's1' } })
  expect(useAppStore.getState().params).toEqual({ height: 40 })
  expect(select).toHaveDisplayValue('Preset: tall')

  fireEvent.change(screen.getByRole('slider', { name: 'width' }), { target: { value: '30' } })
  expect(select).toHaveDisplayValue('Preset: custom')
  fireEvent.change(select, { target: { value: 'save' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Preset name' }), { target: { value: '  wide  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
  await waitFor(() => expect(presetsApi.putPreset).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', name: 'wide', params: { width: 30, height: 40 } })))
  await waitFor(() => expect(select).toHaveDisplayValue('Preset: wide'))

  fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }))
  await waitFor(() => expect(presetsApi.deletePreset).toHaveBeenCalled())
})

it('offers to annotate un-annotated numbers through the composer', () => {
  render(<CustomizerDock />)
  fireEvent.click(screen.getByRole('tab', { name: 'Lid' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI to annotate' }))
  expect(usePromptRequest.getState().request?.text).toBe(ANNOTATE_PROMPT)
})

it('offers to add parameters when the model has none', () => {
  useAppStore.getState().setCode('cube(10);')
  render(<CustomizerDock />)
  expect(screen.getByText('This model has no parameters yet.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI to add parameters' }))
  expect(usePromptRequest.getState().request?.text).toMatch(/^Make this model parametric/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/customizer/CustomizerDock.test.tsx`
Expected: FAIL with "Failed to resolve import './CustomizerDock'".

- [ ] **Step 3: Write minimal implementation**

`src/ui/icons.ts`: add these re-exports to the existing `lucide-react` export list (keep M1's and M2's):

```ts
export {
  ChevronDown as IconChevronDown,
  GitBranch as IconBranch,
  History as IconHistory,
  LayoutGrid as IconGallery,
  Lock as IconLock,
  Pencil as IconManual,
  Plus as IconPlus,
  Redo2 as IconRedo,
  RotateCcw as IconRestore,
  Search as IconSearch,
  SlidersHorizontal as IconSlider,
  Sparkles as IconAi,
  Trash2 as IconTrash,
  Undo2 as IconUndo,
  Unlock as IconUnlock,
  Upload as IconImport,
  Wrench as IconAutofix,
} from 'lucide-react'
```

`src/customizer/CustomizerDock.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { ADD_PARAMETERS_PROMPT, ANNOTATE_PROMPT, usePromptRequest } from '../chat/promptRequest'
import type { Preset } from '../db/db'
import { deletePreset, listPresets, putPreset } from '../db/presets'
import { useProjectStore } from '../history/projectStore'
import { paramsEqual, type Params } from '../render/params'
import { bakeParams, effectiveValues, paramOverrides, parseCustomizer } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { IconTrash } from '../ui/icons'
import { ParamRow } from './ParamRow'

const DEFAULT = 'default'
const CUSTOM = 'custom'
const SAVE = 'save'

const setParams = (params: Params) => useAppStore.getState().setParams(params)
const ask = (text: string) => usePromptRequest.getState().ask(text)

export function CustomizerDock() {
  const code = useAppStore((s) => s.code)
  const params = useAppStore((s) => s.params)
  const projectId = useProjectStore((s) => s.project?.id ?? null)
  const parsed = useMemo(() => parseCustomizer(code), [code])
  const values = useMemo(() => effectiveValues(code, params), [code, params])
  const overrides = useMemo(() => paramOverrides(code, params), [code, params])
  const groups = useMemo(() => [...new Set(parsed.map((p) => p.group))], [parsed])
  const [tab, setTab] = useState('')
  const [presets, setPresets] = useState<Preset[]>([])
  const [saving, setSaving] = useState(false)
  const [presetName, setPresetName] = useState('')

  useEffect(() => {
    let live = true
    if (projectId) void listPresets(projectId).then((list) => live && setPresets([...list]))
    else setPresets([])
    return () => {
      live = false
    }
  }, [projectId])

  const active = groups.includes(tab) ? tab : (groups[0] ?? '')
  const changed = Object.keys(overrides).length
  const selected =
    changed === 0 ? DEFAULT : (presets.find((p) => paramsEqual(paramOverrides(code, p.params), overrides))?.id ?? CUSTOM)

  const reload = async () => {
    if (projectId) setPresets([...(await listPresets(projectId))])
  }

  const onPreset = (id: string) => {
    if (id === SAVE) setSaving(true)
    else if (id === DEFAULT) setParams({})
    else {
      const preset = presets.find((p) => p.id === id)
      if (preset) setParams(preset.params)
    }
  }

  const savePreset = async () => {
    const name = presetName.trim()
    if (!name || !projectId) return
    await putPreset({ id: crypto.randomUUID(), projectId, name, params: overrides })
    await reload()
    setSaving(false)
    setPresetName('')
  }

  const bake = () => {
    const app = useAppStore.getState()
    app.setCode(bakeParams(app.code, paramOverrides(app.code, app.params)), 'slider')
    app.setParams({})
  }

  if (parsed.length === 0) {
    return (
      <section aria-label="Parameters" className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-4 py-3">
        <span className="pc-caption">This model has no parameters yet.</span>
        <span className="flex-1" />
        <button type="button" className="pc-btn is-sm is-ghost" onClick={() => ask(ADD_PARAMETERS_PROMPT)}>
          Ask AI to add parameters
        </button>
      </section>
    )
  }

  const unannotated = parsed.some((p) => p.control.kind === 'number' && !p.annotated)

  return (
    <section aria-label="Parameters" className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-auto border-t border-line bg-panel px-4 pt-3 pb-4">
      <div className="pc-row">
        <div className="pc-tabs" role="tablist" aria-label="Parameter groups">
          {groups.map((g) => (
            <button key={g || 'parameters'} type="button" role="tab" className="pc-tab" aria-selected={g === active} onClick={() => setTab(g)}>
              {g || 'Parameters'}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <select className="pc-select h-(--control-sm) text-[13px]" aria-label="Preset" value={selected} onChange={(e) => onPreset(e.target.value)}>
          <option value={DEFAULT}>Preset: default</option>
          {selected === CUSTOM && (
            <option value={CUSTOM} disabled>
              Preset: custom
            </option>
          )}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              Preset: {p.name}
            </option>
          ))}
          <option value={SAVE} disabled={changed === 0 || !projectId}>
            Save as preset…
          </option>
        </select>
        {presets.some((p) => p.id === selected) && (
          <button
            type="button"
            className="pc-btn is-sm is-ghost is-icon"
            aria-label="Delete preset"
            title="Delete preset"
            onClick={() => void deletePreset(selected).then(reload)}
          >
            <IconTrash className="pc-i" aria-hidden="true" />
          </button>
        )}
        <button type="button" className="pc-btn is-sm is-ghost" disabled={changed === 0} onClick={() => setParams({})}>
          Reset
        </button>
        <button type="button" className="pc-btn is-sm" disabled={changed === 0} onClick={bake}>
          Bake into code
        </button>
      </div>

      {saving && (
        <div className="pc-row">
          <div className="pc-input w-56">
            <input
              aria-label="Preset name"
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void savePreset()}
            />
          </div>
          <button type="button" className="pc-btn is-sm" disabled={presetName.trim() === ''} onClick={() => void savePreset()}>
            Save preset
          </button>
          <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setSaving(false)}>
            Cancel
          </button>
        </div>
      )}

      {parsed
        .filter((p) => p.group === active)
        .map((p) => (
          <ParamRow
            key={p.name}
            param={p}
            value={values[p.name]!}
            onChange={(v) => setParams({ ...useAppStore.getState().params, [p.name]: v })}
          />
        ))}

      {unannotated && (
        <div className="pc-row">
          <span className="pc-caption">Some numbers have no range yet, so they get a plain input.</span>
          <button type="button" className="pc-btn is-sm is-ghost" onClick={() => ask(ANNOTATE_PROMPT)}>
            Ask AI to annotate
          </button>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/customizer && npm run typecheck`
Expected: PASS (6 + 7 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/customizer/CustomizerDock.tsx src/customizer/CustomizerDock.test.tsx src/ui/icons.ts
git commit -m "feat(customizer): dock with group tabs, presets, Reset, Bake into code and Ask AI to annotate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Code pane with the Problems tab, version caption and engine version

**Files:**
- Create: `src/render/engineVersion.ts`, `src/history/sources.ts`, `src/workbench/ProblemsPanel.tsx`, `src/workbench/CodePane.tsx`
- Modify: `src/editor/CodeEditor.tsx`, `src/panels/ConsolePanel.tsx`
- Test: `src/render/engineVersion.test.ts`, `src/workbench/CodePane.test.tsx`, `src/editor/CodeEditor.test.tsx`, `src/panels/ConsolePanel.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (Task 3); `useProjectStore`, `matchesHead` (Task 9); `flushRecorder` (Task 11); `CodeEditor`, `ConsolePanel` (M1); `Diagnostic`, `RenderStatus` (M1); icons (Task 14).
- Produces:
  - `src/render/engineVersion.ts`: `parseEngineVersion(text: string): string | null` (from `public/openscad/VERSION`'s URL line, `OpenSCAD-2026.10.08-…` → `2026.10.08`); `engineLabel(version: string | null): string` ("OpenSCAD 2026.10.08 · manifold", or "OpenSCAD · manifold"); `loadEngineVersion(fetchImpl?: typeof fetch): Promise<string | null>` (`${BASE_URL}openscad/VERSION`, null on any failure).
  - `src/history/sources.ts`: `SOURCE_CAPTION: Record<VersionSource, string>` (code pane: "from AI", "edited by hand", "edited by slider", "auto-fixed", "restored", "from an example", "imported"); `SOURCE_NAME: Record<VersionSource, string>` (History: "AI", "Manual", "Slider", "Auto-fix", "Restore", "Example", "Import"); `SOURCE_ICON: Record<VersionSource, LucideIcon>`; `versionCaption(head: Version | null, editing: boolean): string | null` ("v3 · edited by slider", "v3 · editing").
  - `src/workbench/ProblemsPanel.tsx`: `interface ProblemItem { line: number | null; severity: 'error' | 'warning'; text: string }`; `problemItems(status: RenderStatus, error: string | null, diagnostics: Diagnostic[]): ProblemItem[]` (a failure without a located error, such as a timeout, is listed first without a line); `ProblemsPanel({ items, onGoToLine })`.
  - `src/workbench/CodePane.tsx`: `CodePane({ actions }: { actions?: React.ReactNode })`: the `<section aria-label="Code">` of the workbench: tabs "main.scad" and "Problems N" (N in `text-error` when any error, else `text-warn`; no number when empty), the version caption, `actions` (extra pane-head buttons M2 placed there), the editor (kept mounted while Problems is shown), and the console with the engine label.
  - `CodeEditor` props gain `onBlur?(): void`; a `value` prop change is applied with an annotation and is no longer reported back through `onChange` (it used to echo as a `'manual'` edit).
  - `ConsolePanel` props gain `engineLabel?: string` (default "OpenSCAD · manifold").

- [ ] **Step 1: Write the failing tests**

`src/render/engineVersion.test.ts`:

```ts
import { engineLabel, loadEngineVersion, parseEngineVersion } from './engineVersion'

const VERSION = 'https://files.openscad.org/snapshots/OpenSCAD-2026.10.08-WebAssembly-web.zip\nsha256 274c\n'

it('reads the snapshot date from the installed VERSION file', () => {
  expect(parseEngineVersion(VERSION)).toBe('2026.10.08')
  expect(parseEngineVersion('https://example.test/custom.zip')).toBeNull()
})

it('labels the console head with the engine and backend', () => {
  expect(engineLabel('2026.10.08')).toBe('OpenSCAD 2026.10.08 · manifold')
  expect(engineLabel(null)).toBe('OpenSCAD · manifold')
})

it('loads the version from the base path and survives failures', async () => {
  const ok = vi.fn(async () => new Response(VERSION))
  expect(await loadEngineVersion(ok as unknown as typeof fetch)).toBe('2026.10.08')
  expect(ok).toHaveBeenCalledWith('/openscad/VERSION')
  expect(await loadEngineVersion((async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toBeNull()
  expect(await loadEngineVersion((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBeNull()
})
```

Append to `src/editor/CodeEditor.test.tsx` (and add `fireEvent` to its `@testing-library/react` import):

```tsx
it('does not report a value it was given as an edit', () => {
  const onChange = vi.fn()
  const { rerender } = render(<CodeEditor value="a" onChange={onChange} diagnostics={[]} />)
  rerender(<CodeEditor value="b" onChange={onChange} diagnostics={[]} />)
  expect(onChange).not.toHaveBeenCalled()
})

it('calls onBlur when the editor loses focus', () => {
  const onBlur = vi.fn()
  const { container } = render(<CodeEditor value="a" onChange={() => {}} diagnostics={[]} onBlur={onBlur} />)
  fireEvent.blur(container.querySelector('.cm-content')!)
  expect(onBlur).toHaveBeenCalledTimes(1)
})
```

Append to `src/panels/ConsolePanel.test.tsx`:

```tsx
it('names the engine in the console head', () => {
  const { rerender } = render(<ConsolePanel status="ok" renderMs={1} error={null} logs={[]} />)
  expect(screen.getByText('OpenSCAD · manifold')).toBeInTheDocument()
  rerender(<ConsolePanel status="ok" renderMs={1} error={null} logs={[]} engineLabel="OpenSCAD 2026.10.08 · manifold" />)
  expect(screen.getByText('OpenSCAD 2026.10.08 · manifold')).toBeInTheDocument()
})
```

`src/workbench/CodePane.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useProjectStore } from '../history/projectStore'
import { flushRecorder } from '../history/recorder'
import { useAppStore } from '../state/store'
import { makeVersion } from '../test/fixtures'
import { errorResult, okResult } from '../test/results'
import { failedResult } from '../render/result'
import { CodePane } from './CodePane'

vi.mock('../history/recorder', () => ({ flushRecorder: vi.fn() }))

const CODE = 'w = 10; // [1:50]\ncube(w);'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('https://files.openscad.org/snapshots/OpenSCAD-2026.10.08-WebAssembly-web.zip\n')))
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.getState().setCode(CODE)
  useAppStore.getState().setParams({ w: 20 })
  useProjectStore.setState({ head: makeVersion({ id: 'v3', label: 'v3', code: CODE, params: { w: 20 }, source: 'slider' }) })
})
afterEach(() => vi.unstubAllGlobals())

it('shows the head version and how it was made, or that the editor has unsaved changes', () => {
  render(<CodePane />)
  expect(screen.getByTestId('version-caption')).toHaveTextContent('v3 · edited by slider')
  act(() => useAppStore.getState().setParams({ w: 21 }))
  expect(screen.getByTestId('version-caption')).toHaveTextContent('v3 · editing')
})

it('names the engine version in the console head', async () => {
  render(<CodePane />)
  expect(await screen.findByText('OpenSCAD 2026.10.08 · manifold')).toBeInTheDocument()
})

it('lists problems with a count in the error colour and jumps to a line from the list', () => {
  const { container } = render(<CodePane />)
  act(() => useAppStore.getState().renderFinished(errorResult(), CODE, { w: 20 }))
  const tab = screen.getByRole('tab', { name: /Problems/ })
  expect(tab).toHaveTextContent('Problems1')
  expect(tab.querySelector('.text-error')).toHaveTextContent('1')

  const editor = container.querySelector('.cm-editor')
  fireEvent.click(tab)
  expect(tab).toHaveAttribute('aria-selected', 'true')
  expect(container.querySelector('.cm-editor')).toBe(editor)
  fireEvent.click(screen.getByRole('button', { name: 'Line 1 · Parser error: syntax error' }))
  expect(screen.getByRole('tab', { name: 'main.scad' })).toHaveAttribute('aria-selected', 'true')
  expect(useAppStore.getState().reveal?.line).toBe(1)
})

it('lists a failure without a line, and says when there are no problems', () => {
  render(<CodePane />)
  act(() => useAppStore.getState().renderFinished(failedResult('Render timed out after 60 s'), CODE, {}))
  fireEvent.click(screen.getByRole('tab', { name: /Problems/ }))
  expect(screen.getByTestId('problems')).toHaveTextContent('Render timed out after 60 s')
  act(() => useAppStore.getState().renderFinished(okResult(), CODE, { w: 20 }))
  expect(screen.getByTestId('problems')).toHaveTextContent('No problems in the last render.')
})

it('commits pending edits when the editor loses focus', () => {
  const { container } = render(<CodePane />)
  fireEvent.blur(container.querySelector('.cm-content')!)
  expect(flushRecorder).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/engineVersion.test.ts src/workbench src/editor/CodeEditor.test.tsx src/panels/ConsolePanel.test.tsx`
Expected: FAIL: missing modules `./engineVersion` and `./CodePane`; the CodeEditor echo test fails (`onChange` called with "b"); the onBlur and engine label tests fail.

- [ ] **Step 3: Write minimal implementation**

`src/render/engineVersion.ts`:

```ts
/** "2026.10.08" from public/openscad/VERSION, whose first line is the pinned snapshot URL. */
export function parseEngineVersion(text: string): string | null {
  return /OpenSCAD-(\d{4}\.\d{2}\.\d{2})/.exec(text)?.[1] ?? null
}

export function engineLabel(version: string | null): string {
  return version ? `OpenSCAD ${version} · manifold` : 'OpenSCAD · manifold'
}

export async function loadEngineVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${import.meta.env.BASE_URL}openscad/VERSION`)
    return res.ok ? parseEngineVersion(await res.text()) : null
  } catch {
    return null
  }
}
```

`src/history/sources.ts`:

```ts
import type { LucideIcon } from 'lucide-react'
import type { Version, VersionSource } from '../db/db'
import { IconAi, IconAutofix, IconGallery, IconImport, IconManual, IconRestore, IconSlider } from '../ui/icons'

export const SOURCE_CAPTION: Record<VersionSource, string> = {
  ai: 'from AI',
  manual: 'edited by hand',
  slider: 'edited by slider',
  autofix: 'auto-fixed',
  restore: 'restored',
  gallery: 'from an example',
  import: 'imported',
}

export const SOURCE_NAME: Record<VersionSource, string> = {
  ai: 'AI',
  manual: 'Manual',
  slider: 'Slider',
  autofix: 'Auto-fix',
  restore: 'Restore',
  gallery: 'Example',
  import: 'Import',
}

export const SOURCE_ICON: Record<VersionSource, LucideIcon> = {
  ai: IconAi,
  manual: IconManual,
  slider: IconSlider,
  autofix: IconAutofix,
  restore: IconRestore,
  gallery: IconGallery,
  import: IconImport,
}

/** Code pane caption (screen Main): "v3 · edited by slider", or "v3 · editing" while the change is not a version yet. */
export function versionCaption(head: Version | null, editing: boolean): string | null {
  if (!head) return null
  return `${head.label} · ${editing ? 'editing' : SOURCE_CAPTION[head.source]}`
}
```

`src/workbench/ProblemsPanel.tsx`:

```tsx
import type { Diagnostic } from '../render/types'
import type { RenderStatus } from '../state/store'

export interface ProblemItem {
  line: number | null
  severity: 'error' | 'warning'
  text: string
}

export function problemItems(status: RenderStatus, error: string | null, diagnostics: Diagnostic[]): ProblemItem[] {
  const items: ProblemItem[] = diagnostics.map((d) => ({ line: d.line, severity: d.severity, text: d.message }))
  if (status === 'error' && error && !diagnostics.some((d) => d.severity === 'error')) items.unshift({ line: null, severity: 'error', text: error })
  return items
}

export function ProblemsPanel({ items, onGoToLine }: { items: ProblemItem[]; onGoToLine(line: number): void }) {
  if (items.length === 0) {
    return (
      <p className="pc-caption p-3" data-testid="problems">
        No problems in the last render.
      </p>
    )
  }
  return (
    <div className="pc-console h-full overflow-auto rounded-none border-0 py-1" data-testid="problems">
      {items.map((p, i) => {
        const className = `pc-log ${p.severity === 'error' ? 'is-error' : 'is-warn'}`
        if (p.line === null) {
          return (
            <div key={i} className={className}>
              {p.text}
            </div>
          )
        }
        const line = p.line
        return (
          <button key={i} type="button" className={className} onClick={() => onGoToLine(line)}>
            Line {line} · {p.text}
          </button>
        )
      })}
    </div>
  )
}
```

`src/workbench/CodePane.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { CodeEditor } from '../editor/CodeEditor'
import { matchesHead } from '../history/matchesHead'
import { useProjectStore } from '../history/projectStore'
import { flushRecorder } from '../history/recorder'
import { versionCaption } from '../history/sources'
import { ConsolePanel } from '../panels/ConsolePanel'
import { engineLabel, loadEngineVersion } from '../render/engineVersion'
import { useAppStore } from '../state/store'
import { problemItems, ProblemsPanel } from './ProblemsPanel'

export function CodePane({ actions }: { actions?: React.ReactNode }) {
  const code = useAppStore((s) => s.code)
  const params = useAppStore((s) => s.params)
  const setCode = useAppStore((s) => s.setCode)
  const goToLine = useAppStore((s) => s.goToLine)
  const reveal = useAppStore((s) => s.reveal)
  const status = useAppStore((s) => s.status)
  const logs = useAppStore((s) => s.logs)
  const diagnostics = useAppStore((s) => s.diagnostics)
  const error = useAppStore((s) => s.error)
  const renderMs = useAppStore((s) => s.renderMs)
  const head = useProjectStore((s) => s.head)
  const [tab, setTab] = useState<'code' | 'problems'>('code')
  const [engine, setEngine] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadEngineVersion().then((v) => live && setEngine(v))
    return () => {
      live = false
    }
  }, [])

  const problems = problemItems(status, error, diagnostics)
  const hasError = problems.some((p) => p.severity === 'error')
  const caption = versionCaption(head, head !== null && !matchesHead(code, params, head))

  return (
    <section aria-label="Code" className="flex min-h-0 min-w-0 flex-col border-t border-line bg-panel md:border-t-0 md:border-l">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="pc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'code'} className="pc-tab" onClick={() => setTab('code')}>
            main.scad
          </button>
          <button type="button" role="tab" aria-selected={tab === 'problems'} className="pc-tab" onClick={() => setTab('problems')}>
            Problems
            {problems.length > 0 && <span className={`pc-mono ${hasError ? 'text-error' : 'text-warn'}`}>{problems.length}</span>}
          </button>
        </div>
        <span className="flex-1" />
        {caption && (
          <span className="pc-caption" data-testid="version-caption">
            {caption}
          </span>
        )}
        {actions}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={tab === 'code' ? 'h-full' : 'hidden'}>
          <CodeEditor value={code} onChange={setCode} diagnostics={diagnostics} reveal={reveal} onBlur={flushRecorder} />
        </div>
        {tab === 'problems' && (
          <ProblemsPanel
            items={problems}
            onGoToLine={(line) => {
              setTab('code')
              goToLine(line)
            }}
          />
        )}
      </div>
      <div className="h-44 shrink-0 border-t border-line">
        <ConsolePanel status={status} logs={logs} error={error} renderMs={renderMs} onGoToLine={goToLine} engineLabel={engineLabel(engine)} />
      </div>
    </section>
  )
}
```

`src/editor/CodeEditor.tsx`: four changes, the rest as in M1.

1. Imports: `import { Annotation, EditorState, type Text } from '@codemirror/state'`.
2. Above `interface Props`, add:

```ts
/** Marks the transaction that mirrors a new `value` prop, so it is not reported back as an edit. */
const external = Annotation.define<boolean>()
```

3. `Props` gains `onBlur?(): void`; the component signature becomes `export function CodeEditor({ value, onChange, diagnostics, reveal = null, onBlur }: Props)`, and next to `onChangeRef` add:

```ts
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur
```

4. Replace the `EditorView.updateListener.of(…)` extension with these two, and add the annotation in the value-sync effect:

```ts
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) onChangeRef.current(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            blur: () => {
              onBlurRef.current?.()
            },
          }),
```

```ts
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: external.of(true) })
```

`src/panels/ConsolePanel.tsx`: add `engineLabel?: string` to `Props`, destructure it with the default `engineLabel = 'OpenSCAD · manifold'`, and render it in the head:

```tsx
        <span className="pc-caption ml-auto">{engineLabel}</span>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render/engineVersion.test.ts src/workbench src/editor src/panels && npm run typecheck`
Expected: PASS (3 + 5 + 2 + 1 new tests and the existing editor and console tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/engineVersion.ts src/render/engineVersion.test.ts src/history/sources.ts src/workbench src/editor/CodeEditor.tsx src/editor/CodeEditor.test.tsx src/panels/ConsolePanel.tsx src/panels/ConsolePanel.test.tsx
git commit -m "feat(workbench): code pane with Problems tab, version caption and engine version

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Project export and schema-validated import

**Files:**
- Create: `src/history/projectFile.ts`
- Test: `src/history/projectFile.test.ts`

**Interfaces:**
- Consumes: `db`, `Project`, `Version`, `StoredMessage`, `Preset` (Task 6); `getProject`, `listAllProjects` (Task 6); `listMessages` (Task 6); `listPresets` (Task 6); `listVersions` (Task 7); `isLibraryName` (Task 4); `saveFile` (M1).
- Produces:
  - `PROJECT_FORMAT = 'chatscad-project'`, `BACKUP_FORMAT = 'chatscad-backup'`, `MAX_CODE_LENGTH = 1_000_000`, `MAX_FILE_LENGTH = 50_000_000`.
  - `interface ProjectFile { format: 'chatscad-project'; version: 1; exportedAt: number; project: { name: string; origin: Project['origin']; enabledLibraries: string[] }; headVersionId: string; versions: FileVersion[]; messages: FileMessage[]; presets: FilePreset[] }` with `FileVersion = Omit<Version, 'projectId' | 'thumbnailBlobId'>`, `FileMessage = Omit<StoredMessage, 'projectId' | 'imageBlobIds' | 'usageId'>`, `FilePreset = Omit<Preset, 'projectId'>`; `interface BackupFile { format: 'chatscad-backup'; version: 1; exportedAt: number; projects: ProjectFile[] }`.
  - `exportProject(projectId: string): Promise<ProjectFile>`, `exportAllProjects(): Promise<BackupFile>`: no keys, no usage ids, no thumbnails, no images (spec: "never … included in project exports").
  - `parseImport(data: unknown): { ok: true; files: ProjectFile[] } | { ok: false; error: string }`: validates every field (types, lengths, enums, identifier-shaped parameter names other than `__proto__`/`constructor`/`prototype`, parameter values, parents that appear earlier in the file, unique ids and labels, the head and message versions present in the file, known libraries); the error names the field path ("versions[2].code must be text").
  - `importProjectFile(file: ProjectFile): Promise<Project>`: writes the project with fresh ids in one transaction.
  - `importFromText(text: string): Promise<{ ok: true; projects: Project[] } | { ok: false; error: string }>`: size check, `JSON.parse`, `parseImport`, then import; nothing is written when validation fails.
  - `projectFileName(name: string): string` ("box-with-lid.chatscad.json"); `saveProjectFile(projectId: string): Promise<void>`; `saveBackupFile(): Promise<void>` ("chatscad-backup-2026-10-11.json").

- [ ] **Step 1: Write the failing test**

`src/history/projectFile.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { putMessage } from '../db/messages'
import { putPreset } from '../db/presets'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { exportAllProjects, exportProject, importFromText, parseImport, projectFileName, type ProjectFile } from './projectFile'
import { useProjectStore } from './projectStore'
import { listVersions } from './versions'

const store = () => useProjectStore.getState()
const commit = (code: string, params = {}) =>
  store().commit({ code, params, source: 'manual', message: 'edit', model: null, compileStatus: 'ok', renderMs: 1 })

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

async function sampleProject() {
  const project = await store().newProject({ name: 'Box with lid', code: 'w = 1; // [0:9]\ncube(w);', origin: 'gallery', enabledLibraries: ['BOSL2'] })
  const v2 = await commit('cube(2);', {})
  await commit('cube(3);')
  await store().branchFrom(v2.id)
  await commit('cube(22);', {})
  await putMessage({
    id: 'm1', projectId: project.id, versionId: v2.id, role: 'assistant', content: '<img src=x onerror=alert(1)>',
    imageBlobIds: ['img-1'], audioTranscript: null, model: 'gpt-x', usageId: 'u1', createdAt: 5,
  })
  await putPreset({ id: 's1', projectId: project.id, name: 'big', params: { w: 9 } })
  await db.providerProfiles.put({
    id: 'p', name: 'OpenAI', adapter: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret-key',
    defaultModel: 'gpt-x', cachedModels: [], capabilities: { streaming: true, vision: false, audio: false }, priceTable: {}, createdAt: 1, updatedAt: 1,
  })
  return store().project!
}

it('exports a project without keys, usage ids, thumbnails or images, and imports it as a new project', async () => {
  const original = await sampleProject()
  const file = await exportProject(original.id)
  const text = JSON.stringify(file)
  expect(text).not.toContain('sk-secret-key')
  expect(text).not.toContain('thumbnailBlobId')
  expect(text).not.toContain('img-1')
  expect(text).not.toContain('u1')
  expect(file.versions.map((v) => v.label)).toEqual(['v1', 'v2', 'v3', 'v2.1'])

  const result = await importFromText(text)
  if (!result.ok) throw new Error(result.error)
  const copy = result.projects[0]!
  expect(copy).toMatchObject({ name: 'Box with lid', origin: 'gallery', enabledLibraries: ['BOSL2'] })
  expect(copy.id).not.toBe(original.id)
  const versions = await listVersions(copy.id)
  const byId = new Map(versions.map((v) => [v.id, v]))
  expect(versions.map((v) => `${v.label}<${v.parentId ? byId.get(v.parentId)!.label : '-'}`)).toEqual(['v1<-', 'v2<v1', 'v3<v2', 'v2.1<v2'])
  expect(byId.get(copy.headVersionId!)?.label).toBe('v2.1')
  expect(versions.every((v) => !v.id.startsWith('v') && v.thumbnailBlobId === null)).toBe(true)
  const messages = await db.messages.where('projectId').equals(copy.id).toArray()
  expect(messages).toEqual([expect.objectContaining({ content: '<img src=x onerror=alert(1)>', imageBlobIds: [], usageId: null, versionId: versions[1]!.id })])
  expect(await db.presets.where('projectId').equals(copy.id).toArray()).toEqual([expect.objectContaining({ name: 'big', params: { w: 9 } })])
})

it('exports and imports a backup of every project', async () => {
  await sampleProject()
  await store().newProject({ name: 'Clip', code: 'cube(1);', origin: 'blank' })
  const backup = await exportAllProjects()
  expect(backup.projects.map((p) => p.project.name).sort()).toEqual(['Box with lid', 'Clip'])
  const result = await importFromText(JSON.stringify(backup))
  expect(result.ok && result.projects.map((p) => p.name).sort()).toEqual(['Box with lid', 'Clip'])
  expect(await db.projects.count()).toBe(4)
})

describe('validation', () => {
  let file: ProjectFile
  beforeEach(async () => {
    file = await exportProject((await sampleProject()).id)
  })

  const mutate = (fn: (f: Record<string, any>) => void) => {
    const copy = JSON.parse(JSON.stringify(file))
    fn(copy)
    return copy
  }

  it.each([
    ['a different format', (f: any) => (f.format = 'zip'), 'format must be "chatscad-project" or "chatscad-backup"'],
    ['code that is not text', (f: any) => (f.versions[0].code = 5), 'versions[0].code must be text'],
    ['code that is too long', (f: any) => (f.versions[0].code = 'x'.repeat(1_000_001)), 'versions[0].code is longer than 1,000,000 characters'],
    ['a parent later in the file', (f: any) => (f.versions[1].parentId = f.versions[2].id), 'versions[1].parentId points at a version that is not earlier in the file'],
    ['a __proto__ parameter', (f: any) => (f.versions[0].params = JSON.parse('{"__proto__": 1}')), 'versions[0].params has an invalid parameter name "__proto__"'],
    ['an object parameter value', (f: any) => (f.versions[0].params = { w: { x: 1 } }), 'versions[0].params.w must be a number, true/false, text or a list of 1 to 4 numbers'],
    ['a missing head', (f: any) => (f.headVersionId = 'nope'), 'headVersionId must name a version in the file'],
    ['an unknown library', (f: any) => (f.project.enabledLibraries = ['../evil']), 'project.enabledLibraries[0] must be BOSL2 or MCAD'],
    ['a message on an unknown version', (f: any) => (f.messages[0].versionId = 'nope'), 'messages[0].versionId must name a version in the file'],
    ['an unknown source', (f: any) => (f.versions[0].source = 'magic'), 'versions[0].source must be one of ai, manual, slider, autofix, restore, gallery, import'],
    ['a repeated label', (f: any) => (f.versions[1].label = 'v1'), 'versions[1].label repeats an earlier label'],
  ])('rejects %s and names the field', async (_name, fn, error) => {
    const before = await db.projects.count()
    expect(parseImport(mutate(fn))).toEqual({ ok: false, error })
    expect(await importFromText(JSON.stringify(mutate(fn)))).toEqual({ ok: false, error })
    expect(await db.projects.count()).toBe(before)
  })

  it('names the project inside a backup', () => {
    const bad = mutate((f) => (f.versions[0].code = null))
    expect(parseImport({ format: 'chatscad-backup', version: 1, exportedAt: 1, projects: [file, bad] })).toEqual({
      ok: false,
      error: 'projects[1].versions[0].code must be text',
    })
  })

  it('rejects text that is not JSON', async () => {
    expect(await importFromText('{nope')).toEqual({ ok: false, error: 'The file is not valid JSON' })
  })
})

it('names export files after the project', () => {
  expect(projectFileName('Box with lid')).toBe('box-with-lid.chatscad.json')
  expect(projectFileName('  ***  ')).toBe('project.chatscad.json')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/history/projectFile.test.ts`
Expected: FAIL with "Failed to resolve import './projectFile'".

- [ ] **Step 3: Write minimal implementation**

`src/history/projectFile.ts`:

```ts
import { db, type Preset, type Project, type StoredMessage, type Version, type VersionSource } from '../db/db'
import { listMessages } from '../db/messages'
import { listPresets } from '../db/presets'
import { getProject, listAllProjects } from '../db/projects'
import { saveFile } from '../export/saveFile'
import { isLibraryName } from '../render/libraries'
import type { ParamValue } from '../render/types'
import { listVersions } from './versions'

export const PROJECT_FORMAT = 'chatscad-project'
export const BACKUP_FORMAT = 'chatscad-backup'
export const MAX_CODE_LENGTH = 1_000_000
export const MAX_FILE_LENGTH = 50_000_000

export type FileVersion = Omit<Version, 'projectId' | 'thumbnailBlobId'>
export type FileMessage = Omit<StoredMessage, 'projectId' | 'imageBlobIds' | 'usageId'>
export type FilePreset = Omit<Preset, 'projectId'>

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: 1
  exportedAt: number
  project: { name: string; origin: Project['origin']; enabledLibraries: string[] }
  headVersionId: string
  versions: FileVersion[]
  messages: FileMessage[]
  presets: FilePreset[]
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: 1
  exportedAt: number
  projects: ProjectFile[]
}

export type ParseResult = { ok: true; files: ProjectFile[] } | { ok: false; error: string }

const SOURCES: readonly VersionSource[] = ['ai', 'manual', 'slider', 'autofix', 'restore', 'gallery', 'import']
const ORIGINS: readonly Project['origin'][] = ['blank', 'gallery', 'shared-link']
const ROLES: readonly StoredMessage['role'][] = ['user', 'assistant', 'note']
const STATUSES: readonly Version['compileStatus'][] = ['ok', 'error', 'pending']
const KINDS: readonly Version['kind'][] = ['main', 'variant']
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
const LABEL = /^v\d+(\.\d+)*$/

class Invalid extends Error {}

function fail(path: string, what: string): never {
  throw new Invalid(`${path} ${what}`)
}

type Obj = Record<string, unknown>

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'must be an object')
  return v as Obj
}

function str(o: Obj, key: string, path: string, max: number): string {
  const v = o[key]
  if (typeof v !== 'string') fail(`${path}${key}`, 'must be text')
  if (v.length > max) fail(`${path}${key}`, `is longer than ${max.toLocaleString('en-US')} characters`)
  return v
}

const strOrNull = (o: Obj, key: string, path: string, max: number): string | null => (o[key] === null ? null : str(o, key, path, max))

function num(o: Obj, key: string, path: string): number {
  const v = o[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}${key}`, 'must be a number')
  return v
}

const numOrNull = (o: Obj, key: string, path: string): number | null => (o[key] === null ? null : num(o, key, path))

function oneOf<T extends string>(o: Obj, key: string, path: string, values: readonly T[]): T {
  const v = o[key]
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) fail(`${path}${key}`, `must be one of ${values.join(', ')}`)
  return v as T
}

function list(o: Obj, key: string, path: string, max: number): unknown[] {
  const v = o[key]
  if (!Array.isArray(v)) fail(`${path}${key}`, 'must be a list')
  if (v.length > max) fail(`${path}${key}`, `has more than ${max.toLocaleString('en-US')} entries`)
  return v
}

function params(v: unknown, path: string): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  for (const [name, value] of Object.entries(obj(v, path))) {
    if (FORBIDDEN.has(name) || !PARAM_NAME.test(name)) fail(path, `has an invalid parameter name "${name}"`)
    if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 10_000)) {
      out[name] = value
    } else if (Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      out[name] = [...(value as number[])]
    } else {
      fail(`${path}.${name}`, 'must be a number, true/false, text or a list of 1 to 4 numbers')
    }
  }
  return out
}

function parseProject(v: unknown, at: string): ProjectFile {
  const p = at ? `${at}.` : ''
  const o = obj(v, at || 'The file')
  if (o.format !== PROJECT_FORMAT) fail(`${p}format`, `must be "${PROJECT_FORMAT}"`)
  if (o.version !== 1) fail(`${p}version`, 'must be 1')

  const project = obj(o.project, `${p}project`)
  const name = str(project, 'name', `${p}project.`, 200).trim()
  if (name === '') fail(`${p}project.name`, 'must not be empty')
  const origin = oneOf(project, 'origin', `${p}project.`, ORIGINS)
  const enabledLibraries = list(project, 'enabledLibraries', `${p}project.`, 10).map((lib, i) =>
    typeof lib === 'string' && isLibraryName(lib) ? lib : fail(`${p}project.enabledLibraries[${i}]`, 'must be BOSL2 or MCAD'),
  )

  const ids = new Set<string>()
  const labels = new Set<string>()
  const versions = list(o, 'versions', p, 5_000).map((raw, i): FileVersion => {
    const path = `${p}versions[${i}].`
    const x = obj(raw, `${p}versions[${i}]`)
    const id = str(x, 'id', path, 100)
    if (ids.has(id)) fail(`${path}id`, 'repeats an earlier id')
    const parentId = strOrNull(x, 'parentId', path, 100)
    if (parentId !== null && !ids.has(parentId)) fail(`${path}parentId`, 'points at a version that is not earlier in the file')
    const label = str(x, 'label', path, 50)
    if (!LABEL.test(label)) fail(`${path}label`, 'must look like v3 or v3.1')
    if (labels.has(label)) fail(`${path}label`, 'repeats an earlier label')
    const version: FileVersion = {
      id,
      parentId,
      code: str(x, 'code', path, MAX_CODE_LENGTH),
      params: params(x.params, `${path}params`),
      source: oneOf(x, 'source', path, SOURCES),
      kind: oneOf(x, 'kind', path, KINDS),
      variantGroupId: strOrNull(x, 'variantGroupId', path, 100),
      label,
      message: str(x, 'message', path, 2_000),
      model: strOrNull(x, 'model', path, 200),
      compileStatus: oneOf(x, 'compileStatus', path, STATUSES),
      renderMs: numOrNull(x, 'renderMs', path),
      createdAt: num(x, 'createdAt', path),
    }
    ids.add(id)
    labels.add(label)
    return version
  })
  if (versions.length === 0) fail(`${p}versions`, 'must contain at least one version')

  const head = o.headVersionId
  if (typeof head !== 'string' || !ids.has(head)) fail(`${p}headVersionId`, 'must name a version in the file')

  const messages = list(o, 'messages', p, 20_000).map((raw, i): FileMessage => {
    const path = `${p}messages[${i}].`
    const x = obj(raw, `${p}messages[${i}]`)
    const versionId = strOrNull(x, 'versionId', path, 100)
    if (versionId !== null && !ids.has(versionId)) fail(`${path}versionId`, 'must name a version in the file')
    return {
      id: str(x, 'id', path, 100),
      versionId,
      role: oneOf(x, 'role', path, ROLES),
      content: str(x, 'content', path, 200_000),
      audioTranscript: strOrNull(x, 'audioTranscript', path, 20_000),
      model: strOrNull(x, 'model', path, 200),
      createdAt: num(x, 'createdAt', path),
    }
  })

  const presets = list(o, 'presets', p, 1_000).map((raw, i): FilePreset => {
    const path = `${p}presets[${i}].`
    const x = obj(raw, `${p}presets[${i}]`)
    return { id: str(x, 'id', path, 100), name: str(x, 'name', path, 100), params: params(x.params, `${path}params`) }
  })

  return {
    format: PROJECT_FORMAT,
    version: 1,
    exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : 0,
    project: { name, origin, enabledLibraries },
    headVersionId: head,
    versions,
    messages,
    presets,
  }
}

export function parseImport(data: unknown): ParseResult {
  try {
    const o = obj(data, 'The file')
    if (o.format === BACKUP_FORMAT) {
      if (o.version !== 1) fail('version', 'must be 1')
      return { ok: true, files: list(o, 'projects', '', 1_000).map((p, i) => parseProject(p, `projects[${i}]`)) }
    }
    if (o.format !== PROJECT_FORMAT) fail('format', `must be "${PROJECT_FORMAT}" or "${BACKUP_FORMAT}"`)
    return { ok: true, files: [parseProject(o, '')] }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }
}

export async function exportProject(projectId: string): Promise<ProjectFile> {
  const project = await getProject(projectId)
  if (!project || !project.headVersionId) throw new Error(`Project ${projectId} not found`)
  const [versions, messages, presets] = await Promise.all([listVersions(projectId), listMessages(projectId), listPresets(projectId)])
  return {
    format: PROJECT_FORMAT,
    version: 1,
    exportedAt: Date.now(),
    project: { name: project.name, origin: project.origin, enabledLibraries: project.enabledLibraries },
    headVersionId: project.headVersionId,
    versions: versions.map((v) => ({
      id: v.id, parentId: v.parentId, code: v.code, params: v.params, source: v.source, kind: v.kind, variantGroupId: v.variantGroupId,
      label: v.label, message: v.message, model: v.model, compileStatus: v.compileStatus, renderMs: v.renderMs, createdAt: v.createdAt,
    })),
    messages: messages.map((m) => ({
      id: m.id, versionId: m.versionId, role: m.role, content: m.content, audioTranscript: m.audioTranscript, model: m.model, createdAt: m.createdAt,
    })),
    presets: presets.map((p) => ({ id: p.id, name: p.name, params: p.params })),
  }
}

export async function exportAllProjects(): Promise<BackupFile> {
  const projects = await listAllProjects()
  return { format: BACKUP_FORMAT, version: 1, exportedAt: Date.now(), projects: await Promise.all(projects.map((p) => exportProject(p.id))) }
}

export async function importProjectFile(file: ProjectFile): Promise<Project> {
  const projectId = crypto.randomUUID()
  const newId = new Map(file.versions.map((v) => [v.id, crypto.randomUUID()]))
  const now = Date.now()
  const project: Project = {
    id: projectId,
    name: file.project.name,
    createdAt: now,
    updatedAt: now,
    headVersionId: newId.get(file.headVersionId)!,
    providerProfileId: null,
    enabledLibraries: file.project.enabledLibraries,
    origin: file.project.origin,
  }
  const versions: Version[] = file.versions.map((v) => ({
    ...v,
    id: newId.get(v.id)!,
    projectId,
    parentId: v.parentId === null ? null : newId.get(v.parentId)!,
    thumbnailBlobId: null,
  }))
  const messages: StoredMessage[] = file.messages.map((m) => ({
    ...m,
    id: crypto.randomUUID(),
    projectId,
    versionId: m.versionId === null ? null : newId.get(m.versionId)!,
    imageBlobIds: [],
    usageId: null,
  }))
  const presets: Preset[] = file.presets.map((p) => ({ ...p, id: crypto.randomUUID(), projectId }))
  await db.transaction('rw', [db.projects, db.versions, db.messages, db.presets], async () => {
    await db.projects.add(project)
    await db.versions.bulkAdd(versions)
    await db.messages.bulkAdd(messages)
    await db.presets.bulkAdd(presets)
  })
  return project
}

export async function importFromText(text: string): Promise<{ ok: true; projects: Project[] } | { ok: false; error: string }> {
  if (text.length > MAX_FILE_LENGTH) return { ok: false, error: 'The file is larger than 50 MB' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The file is not valid JSON' }
  }
  const parsed = parseImport(data)
  if (!parsed.ok) return parsed
  const projects: Project[] = []
  for (const file of parsed.files) projects.push(await importProjectFile(file))
  return { ok: true, projects }
}

export function projectFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug || 'project'}.chatscad.json`
}

const jsonBlob = (data: unknown) => new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })

export async function saveProjectFile(projectId: string): Promise<void> {
  const file = await exportProject(projectId)
  await saveFile(jsonBlob(file), projectFileName(file.project.name))
}

export async function saveBackupFile(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  await saveFile(jsonBlob(await exportAllProjects()), `chatscad-backup-${date}.json`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/history/projectFile.test.ts && npm run typecheck`
Expected: PASS (16 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/history/projectFile.ts src/history/projectFile.test.ts
git commit -m "feat(history): export and schema-validated import of projects and backups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: History view

**Files:**
- Create: `src/history/timeline.ts`, `src/history/DiffView.tsx`, `src/ui/Glyph.tsx`, `src/history/VersionThumb.tsx`, `src/history/usePreviewRender.ts`, `src/history/HistoryView.tsx`
- Test: `src/history/timeline.test.ts`, `src/history/usePreviewRender.test.ts`, `src/history/HistoryView.test.tsx`

**Interfaces:**
- Consumes: `useProjectStore` (Task 9); `sideBySide`, `DiffRow` (Task 8); `describeParamChanges` (Task 8); `effectiveValues` (Task 2); `SOURCE_ICON`, `SOURCE_NAME` (Task 15); `getBlob` (Task 6); `messagesForVersion` (Task 6); `usageForVersion` (Task 12); `saveProjectFile` (Task 16); `RenderController`, `WorkerFactory` (M1); `buildRenderRequest` (Task 3); `Viewer` (Task 10); `useAppStore.setView` (Task 3); `formatCost`, `formatTokens` (M2); icons (Task 14).
- Produces:
  - `src/history/timeline.ts`: `interface TimelineRow { version: Version; branch: boolean; isHead: boolean; variantsNotPicked: number }`; `interface Timeline { rows: TimelineRow[]; count: number; branches: number }`; `buildTimeline(versions: Version[], headId: string | null): Timeline` (the trunk runs from the root along the head's path, then the first child; trunk newest first; each trunk version is followed by its other children's subtrees, newest first, marked `branch`; `kind: 'variant'` versions are not rows but counted on the row with the same `variantGroupId`); `formatAge(ms: number): string` ("now", "4 min", "3 h", "2 d"); `timelineCaption(t: Timeline): string` ("7 versions · 1 branch").
  - `src/ui/Glyph.tsx`: `type GlyphShape`, `Glyph({ shapes })` (the screens' iso line glyph, `f-l`/`f-r`/`f-top`/`f-hole` classes), `BOX_GLYPH`, `FAILED_GLYPH` (no hole).
  - `src/history/VersionThumb.tsx`: `VersionThumb({ version })`: the stored thumbnail as an object URL (revoked on unmount) or the glyph.
  - `src/history/DiffView.tsx`: `DiffView({ rows }: { rows: DiffRow[] })`: two code columns; added lines on `bg-ok-soft` with "+", removed on `bg-error-soft` with "−", "⋯ 7 unchanged lines"; text nodes only.
  - `src/history/usePreviewRender.ts`: `interface PreviewState { status: 'idle' | 'rendering' | 'ok' | 'error'; mesh: MeshData | null; renderMs: number | null; error: string | null }`; `usePreviewRender(createWorker: WorkerFactory, version: Version | null, libraries: string[]): PreviewState`: its own `RenderController` and worker (created on mount, disposed on unmount), so previewing never disturbs the workbench render; a new version clears the old mesh.
  - `src/history/HistoryView.tsx`: `HistoryView({ createWorker }: { createWorker: WorkerFactory })`: Versions | Compare | Preview (screen History). Selecting a row previews it without moving the head. Compare defaults to the selected version's parent → the selected version, shows `+N` / `−N` and, when parameters differ, a "Parameters: …" line. Restore vN (primary) → `restore(id)` then the workbench; Branch from here → `branchFrom(id)` then the workbench; both disabled for the current version. Footer: "Export project (.json)".

- [ ] **Step 1: Write the failing tests**

`src/history/timeline.test.ts`:

```ts
import type { Version } from '../db/db'
import { makeVersion } from '../test/fixtures'
import { buildTimeline, formatAge, timelineCaption } from './timeline'

const v = (id: string, parentId: string | null, createdAt: number, over: Partial<Version> = {}) =>
  makeVersion({ id, label: id, parentId, createdAt, ...over })

const screenVersions = [
  v('v1', null, 1),
  v('v2', 'v1', 2),
  v('v3', 'v2', 3),
  v('v3.1', 'v3', 4),
  v('v4', 'v3', 5, { compileStatus: 'error' }),
  v('v5', 'v4', 6),
  v('v6', 'v5', 7, { variantGroupId: 'g1' }),
  v('v6.1', 'v5', 8, { kind: 'variant', variantGroupId: 'g1' }),
  v('v6.2', 'v5', 9, { kind: 'variant', variantGroupId: 'g1' }),
]

it('orders the trunk newest first with each branch under its parent, as on the History screen', () => {
  const t = buildTimeline(screenVersions, 'v6')
  expect(t.rows.map((r) => `${r.version.label}${r.branch ? ' branch' : ''}${r.isHead ? ' head' : ''}`)).toEqual([
    'v6 head', 'v5', 'v4', 'v3', 'v3.1 branch', 'v2', 'v1',
  ])
  expect(t.rows[0]!.variantsNotPicked).toBe(2)
  expect(t.count).toBe(7)
  expect(t.branches).toBe(1)
  expect(timelineCaption(t)).toBe('7 versions · 1 branch')
})

it('keeps newer versions on the trunk after an undo moved the head back', () => {
  const versions = [v('v1', null, 1), v('v2', 'v1', 2), v('v3', 'v2', 3)]
  expect(buildTimeline(versions, 'v2').rows.map((r) => `${r.version.label}${r.isHead ? ' head' : ''}`)).toEqual(['v3', 'v2 head', 'v1'])
})

it('follows the head into a branch and shows deeper branch versions newest first', () => {
  const versions = [v('v1', null, 1), v('v2', 'v1', 2), v('v1.1', 'v1', 3), v('v1.2', 'v1.1', 4), v('v3', 'v2', 5)]
  expect(buildTimeline(versions, 'v1.2').rows.map((r) => `${r.version.label}${r.branch ? ' branch' : ''}`)).toEqual([
    'v1.2', 'v1.1', 'v1', 'v3 branch', 'v2 branch',
  ])
})

it('formats ages and captions in the design voice', () => {
  expect(formatAge(20_000)).toBe('now')
  expect(formatAge(4 * 60_000)).toBe('4 min')
  expect(formatAge(3 * 3_600_000)).toBe('3 h')
  expect(formatAge(2 * 86_400_000)).toBe('2 d')
  expect(timelineCaption({ rows: [], count: 1, branches: 0 })).toBe('1 version')
  expect(timelineCaption({ rows: [], count: 3, branches: 2 })).toBe('3 versions · 2 branches')
})
```

`src/history/usePreviewRender.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react'
import type { RenderWorkerHandle } from '../render/createRenderWorker'
import type { RenderRequest } from '../render/types'
import { makeVersion } from '../test/fixtures'
import { errorResult, okResult } from '../test/results'
import { usePreviewRender } from './usePreviewRender'

it('renders the previewed version in its own worker, clears the old mesh on a new version, and disposes the worker', async () => {
  const requests: RenderRequest[] = []
  const handle: RenderWorkerHandle = {
    render: async (req) => {
      requests.push(req)
      return req.code.includes('broken') ? errorResult() : okResult()
    },
    terminate: vi.fn(),
  }
  const createWorker = vi.fn(() => handle)
  const a = makeVersion({ id: 'a', code: 'w = 1; // [0:9]\ncube(w);', params: { w: 5 } })
  const b = makeVersion({ id: 'b', code: 'broken(' })
  const { result, rerender, unmount } = renderHook(({ version }) => usePreviewRender(createWorker, version, ['MCAD']), {
    initialProps: { version: a },
  })
  await waitFor(() => expect(result.current.status).toBe('ok'))
  expect(result.current.mesh).not.toBeNull()
  expect(requests[0]).toEqual({ code: a.code, params: { w: 5 }, libraries: ['MCAD'] })

  rerender({ version: b })
  expect(result.current.mesh).toBeNull()
  await waitFor(() => expect(result.current).toMatchObject({ status: 'error', error: 'OpenSCAD exited with code 1' }))

  unmount()
  expect(handle.terminate).toHaveBeenCalled()
  expect(createWorker).toHaveBeenCalledTimes(1)
})
```

`src/history/HistoryView.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Version } from '../db/db'
import { useAppStore } from '../state/store'
import { makeProject, makeVersion } from '../test/fixtures'
import { HistoryView } from './HistoryView'
import { saveProjectFile } from './projectFile'
import { useProjectStore } from './projectStore'

vi.mock('../viewer/Viewer', () => ({ Viewer: () => <div data-testid="preview-viewer" /> }))
vi.mock('./usePreviewRender', () => ({ usePreviewRender: () => ({ status: 'ok', mesh: null, renderMs: 431, error: null }) }))
vi.mock('../db/blobs', () => ({ getBlob: async () => undefined }))
vi.mock('../db/messages', () => ({
  messagesForVersion: async (id: string) =>
    id === 'v5' ? [{ id: 'm', role: 'assistant', content: 'Closed the translate() call on line 16. No other changes.' }] : [],
}))
vi.mock('../db/usageLinks', () => ({
  usageForVersion: async (id: string) => (id === 'v5' ? [{ inputTokens: 600, outputTokens: 40, cost: 0.002 }] : []),
}))
vi.mock('./projectFile', () => ({ saveProjectFile: vi.fn(async () => {}) }))

const NOW = 10_000_000
const min = 60_000
const v = (id: string, parentId: string | null, ago: number, over: Partial<Version> = {}) =>
  makeVersion({ id, label: id, parentId, createdAt: NOW - ago * min, ...over })

const versions = [
  v('v1', null, 21, { source: 'ai', message: 'A holder for four 18650 cells…', code: 'slots = 4;\n' }),
  v('v2', 'v1', 18, { source: 'ai', message: '<img src=x onerror=alert(1)>', code: 'slots = 4;\nwall = 2.4;\n' }),
  v('v3', 'v2', 12, { source: 'slider', message: 'height 18 → 22', code: 'slots = 4;\nwall = 2.4;\n', params: { slots: 5 } }),
  v('v3.1', 'v3', 10, { source: 'manual', message: 'Edited code · +1 −1 lines' }),
  v('v4', 'v3', 5, { source: 'ai', message: 'Make it hold 21700 cells', compileStatus: 'error' }),
  v('v5', 'v4', 4, { source: 'autofix', message: 'Auto-fix: closed translate() on line 16', model: 'claude-sonnet-5-5', renderMs: 431, code: 'slots = 4;\nbore = 21.5;\n' }),
  v('v6', 'v5', 0, { source: 'slider', message: 'slots 4 → 5' }),
]

const restore = vi.fn(async () => versions[0]!)
const branchFrom = vi.fn(async () => {})
const createWorker = () => ({ render: vi.fn(), terminate: vi.fn() })

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  restore.mockClear()
  branchFrom.mockClear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.getState().setView('history')
  useProjectStore.setState({ project: makeProject({ id: 'p1' }), versions, head: versions[6]!, restore, branchFrom })
})
afterEach(() => vi.restoreAllMocks())

const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.pc-version')]

it('lists versions as on the History screen: current first, failed dimmed, branch indented', () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  expect(screen.getByText('7 versions · 1 branch')).toBeInTheDocument()
  expect(rows(container).map((r) => r.querySelector('.t')!.textContent)).toEqual(['v6 · current', 'v5', 'v4', 'v3', 'v3.1', 'v2', 'v1'])
  const v4 = rows(container)[2]!
  expect(v4).toHaveClass('is-failed')
  expect(v4.querySelector('.m')).toHaveTextContent('Failed · Make it hold 21700 cells')
  expect(rows(container)[4]).toHaveClass('is-branch')
  expect(within(rows(container)[1]!).getByText('4 min')).toBeInTheDocument()
  expect(rows(container)[0]).toHaveAttribute('aria-current', 'true')
})

it('shows messages as text, never as HTML', () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  expect(container.querySelector('img')).toBeNull()
})

it('previews a selected version without moving the head, with its details and reply', async () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  expect(screen.getByText('Preview · v6')).toBeInTheDocument()
  expect(screen.getByText('current version')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Restore v6' })).toBeDisabled()

  fireEvent.click(rows(container)[1]!)
  expect(rows(container)[1]).toHaveAttribute('aria-current', 'true')
  expect(screen.getByText('Preview · v5')).toBeInTheDocument()
  expect(screen.getByText('not the current version')).toBeInTheDocument()
  expect(screen.getByText('v5 · Auto-fix')).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByTestId('preview-meta')).toHaveTextContent('claude-sonnet-5-5 · 4 min ago · rendered in 431 ms · 640 tok · $0.002'),
  )
  expect(screen.getByTestId('preview-message')).toHaveTextContent('Closed the translate() call on line 16. No other changes.')
  expect(useProjectStore.getState().head?.id).toBe('v6')
  expect(screen.getByText('Restoring makes a new version. Nothing is deleted.')).toBeInTheDocument()
})

it('compares the selected version with its parent by default, and any two versions on request', () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  fireEvent.click(rows(container)[3]!)
  expect(screen.getByRole('combobox', { name: 'From version' })).toHaveDisplayValue('v2')
  expect(screen.getByRole('combobox', { name: 'To version' })).toHaveDisplayValue('v3')
  expect(screen.getByTestId('param-diff')).toHaveTextContent('Parameters: slots 4 → 5')

  fireEvent.change(screen.getByRole('combobox', { name: 'From version' }), { target: { value: 'v1' } })
  expect(screen.getByTestId('diff-added')).toHaveTextContent('+1')
  expect(screen.getByTestId('diff-removed')).toHaveTextContent('−0')
  expect(container.querySelector('[data-kind="add"]')).toHaveTextContent('wall = 2.4;')
})

it('restores or branches from the previewed version and returns to the workbench', async () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  fireEvent.click(rows(container)[1]!)
  fireEvent.click(screen.getByRole('button', { name: 'Restore v5' }))
  await waitFor(() => expect(restore).toHaveBeenCalledWith('v5'))
  await waitFor(() => expect(useAppStore.getState().view).toBe('workbench'))

  useAppStore.getState().setView('history')
  fireEvent.click(screen.getByRole('button', { name: 'Branch from here' }))
  await waitFor(() => expect(branchFrom).toHaveBeenCalledWith('v5'))
})

it('exports the project from the footer', () => {
  render(<HistoryView createWorker={createWorker} />)
  fireEvent.click(screen.getByRole('button', { name: 'Export project (.json)' }))
  expect(saveProjectFile).toHaveBeenCalledWith('p1')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/history/timeline.test.ts src/history/usePreviewRender.test.ts src/history/HistoryView.test.tsx`
Expected: FAIL with "Failed to resolve import './timeline'", "… './usePreviewRender'", "… './HistoryView'".

- [ ] **Step 3: Write minimal implementation**

`src/history/timeline.ts`:

```ts
import type { Version } from '../db/db'

export interface TimelineRow {
  version: Version
  branch: boolean
  isHead: boolean
  variantsNotPicked: number
}

export interface Timeline {
  rows: TimelineRow[]
  count: number
  branches: number
}

const byTime = (a: Version, b: Version) => a.createdAt - b.createdAt

export function buildTimeline(versions: Version[], headId: string | null): Timeline {
  const main = versions.filter((v) => v.kind === 'main')
  const byId = new Map(main.map((v) => [v.id, v]))
  const children = new Map<string | null, Version[]>()
  for (const v of main) children.set(v.parentId, [...(children.get(v.parentId) ?? []), v])
  for (const list of children.values()) list.sort(byTime)

  const variants = new Map<string, number>()
  for (const v of versions) if (v.kind === 'variant' && v.variantGroupId) variants.set(v.variantGroupId, (variants.get(v.variantGroupId) ?? 0) + 1)

  const headPath = new Set<string>()
  for (let id = headId; id !== null && !headPath.has(id); id = byId.get(id)?.parentId ?? null) headPath.add(id)

  const roots = children.get(null) ?? []
  const trunk: Version[] = []
  const seen = new Set<string>()
  let cur: Version | undefined = roots.find((r) => headPath.has(r.id)) ?? roots[0]
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    trunk.push(cur)
    const kids: Version[] = children.get(cur.id) ?? []
    cur = kids.find((k) => headPath.has(k.id)) ?? kids[0]
  }

  const subtree = (root: Version): Version[] => [root, ...(children.get(root.id) ?? []).flatMap(subtree)]
  const row = (version: Version, branch: boolean): TimelineRow => ({
    version,
    branch,
    isHead: version.id === headId,
    variantsNotPicked: version.variantGroupId ? (variants.get(version.variantGroupId) ?? 0) : 0,
  })
  const branchRows = (root: Version) => subtree(root).sort((a, b) => b.createdAt - a.createdAt).map((v) => row(v, true))

  const rows: TimelineRow[] = []
  let branches = 0
  for (const t of [...trunk].reverse()) {
    rows.push(row(t, false))
    const off = (children.get(t.id) ?? []).filter((c) => !seen.has(c.id))
    branches += off.length
    for (const b of [...off].reverse()) rows.push(...branchRows(b))
  }
  for (const r of roots) {
    if (seen.has(r.id)) continue
    branches++
    rows.push(...branchRows(r))
  }
  return { rows, count: main.length, branches }
}

export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

export function timelineCaption(t: Timeline): string {
  const versions = `${t.count} version${t.count === 1 ? '' : 's'}`
  return t.branches > 0 ? `${versions} · ${t.branches} branch${t.branches === 1 ? '' : 'es'}` : versions
}
```

`src/ui/Glyph.tsx`:

```tsx
export type GlyphShape =
  | { kind: 'polygon'; face: 'f-l' | 'f-r' | 'f-top'; points: string }
  | { kind: 'ellipse'; face: 'f-hole'; cx: number; cy: number; rx: number; ry: number }

/** The screens' iso line glyph; `pc-thumb` and `pc-variant-view` colour the faces from tokens. */
export function Glyph({ shapes }: { shapes: GlyphShape[] }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {shapes.map((s, i) =>
        s.kind === 'polygon' ? (
          <polygon key={i} className={s.face} points={s.points} />
        ) : (
          <ellipse key={i} className={s.face} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />
        ),
      )}
    </svg>
  )
}

export const FAILED_GLYPH: GlyphShape[] = [
  { kind: 'polygon', face: 'f-l', points: '14,36 50,54 50,82 14,64' },
  { kind: 'polygon', face: 'f-r', points: '50,54 86,36 86,64 50,82' },
  { kind: 'polygon', face: 'f-top', points: '50,18 86,36 50,54 14,36' },
]

export const BOX_GLYPH: GlyphShape[] = [...FAILED_GLYPH, { kind: 'ellipse', face: 'f-hole', cx: 50, cy: 36, rx: 12, ry: 6 }]
```

`src/history/VersionThumb.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Version } from '../db/db'
import { getBlob } from '../db/blobs'
import { BOX_GLYPH, FAILED_GLYPH, Glyph } from '../ui/Glyph'

export function VersionThumb({ version }: { version: Version }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!version.thumbnailBlobId) return
    let live = true
    let created: string | null = null
    void getBlob(version.thumbnailBlobId).then((stored) => {
      if (!live || !stored) return
      created = URL.createObjectURL(stored.data)
      setUrl(created)
    })
    return () => {
      live = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [version.thumbnailBlobId])
  return (
    <span className="pc-thumb">
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <Glyph shapes={version.compileStatus === 'error' ? FAILED_GLYPH : BOX_GLYPH} />}
    </span>
  )
}
```

`src/history/DiffView.tsx`:

```tsx
import { Fragment } from 'react'
import type { DiffCell, DiffRow } from './diff'

function Cell({ cell, divider = false }: { cell: DiffCell | null; divider?: boolean }) {
  const tone = cell?.kind === 'add' ? 'bg-ok-soft' : cell?.kind === 'del' ? 'bg-error-soft' : ''
  const mark = cell?.kind === 'add' ? '+' : cell?.kind === 'del' ? '−' : ''
  return (
    <div className={`grid grid-cols-[44px_14px_minmax(0,1fr)] whitespace-pre ${tone} ${divider ? 'border-r border-line' : ''}`} data-kind={cell?.kind ?? 'empty'}>
      <span className="pr-2 text-right text-syn-comment">{cell?.line ?? ''}</span>
      <span className="grid place-items-center">{mark}</span>
      <span className="overflow-hidden text-ink">{cell?.text ?? ''}</span>
    </div>
  )
}

export function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 overflow-auto bg-inset py-2 font-mono text-[13px] leading-5" data-testid="diff">
      {rows.map((r, i) =>
        r.kind === 'skip' ? (
          <div key={i} className="pc-caption col-span-2 py-0.5 pl-[58px] font-sans">
            ⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}
          </div>
        ) : (
          <Fragment key={i}>
            <Cell cell={r.left} divider />
            <Cell cell={r.right} />
          </Fragment>
        ),
      )}
    </div>
  )
}
```

`src/history/usePreviewRender.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import type { Version } from '../db/db'
import { RenderController } from '../render/controller'
import type { WorkerFactory } from '../render/createRenderWorker'
import type { MeshData } from '../render/types'
import { buildRenderRequest } from '../render/useRenderLoop'

export interface PreviewState {
  status: 'idle' | 'rendering' | 'ok' | 'error'
  mesh: MeshData | null
  renderMs: number | null
  error: string | null
}

const IDLE: PreviewState = { status: 'idle', mesh: null, renderMs: null, error: null }

/** A second RenderController with its own worker, so previews never disturb the workbench render. */
export function usePreviewRender(createWorker: WorkerFactory, version: Version | null, libraries: string[]): PreviewState {
  const [state, setState] = useState<PreviewState>(IDLE)
  const controllerRef = useRef<RenderController | null>(null)

  useEffect(() => {
    const controller = new RenderController({
      createWorker,
      debounceMs: 0,
      onStart: () => setState((s) => ({ ...s, status: 'rendering' })),
      onResult: (r) =>
        setState(r.ok ? { status: 'ok', mesh: r.mesh, renderMs: r.renderMs, error: null } : { status: 'error', mesh: null, renderMs: r.renderMs, error: r.error }),
    })
    controllerRef.current = controller
    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [createWorker])

  const key = libraries.join(',')
  useEffect(() => {
    setState({ ...IDLE, status: version ? 'rendering' : 'idle' })
    if (version) controllerRef.current?.request(buildRenderRequest(version.code, version.params, key ? key.split(',') : []), { immediate: true })
  }, [version, key])

  return state
}
```

`src/history/HistoryView.tsx`:

```tsx
import { Fragment, useEffect, useMemo, useState } from 'react'
import { messagesForVersion } from '../db/messages'
import { usageForVersion } from '../db/usageLinks'
import type { WorkerFactory } from '../render/createRenderWorker'
import { effectiveValues } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { formatCost, formatTokens } from '../ui/format'
import { IconRestore, IconX } from '../ui/icons'
import { Viewer } from '../viewer/Viewer'
import { sideBySide } from './diff'
import { DiffView } from './DiffView'
import { describeParamChanges } from './messages'
import { saveProjectFile } from './projectFile'
import { useProjectStore } from './projectStore'
import { SOURCE_ICON, SOURCE_NAME } from './sources'
import { buildTimeline, formatAge, timelineCaption } from './timeline'
import { usePreviewRender } from './usePreviewRender'
import { VersionThumb } from './VersionThumb'

interface Details {
  reply: string | null
  tokens: number
  cost: number | null
}

const NO_DETAILS: Details = { reply: null, tokens: 0, cost: null }

export function HistoryView({ createWorker }: { createWorker: WorkerFactory }) {
  const project = useProjectStore((s) => s.project)
  const versions = useProjectStore((s) => s.versions)
  const head = useProjectStore((s) => s.head)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [details, setDetails] = useState<Details>(NO_DETAILS)

  const timeline = useMemo(() => buildTimeline(versions, head?.id ?? null), [versions, head])
  const find = (id: string | null) => (id ? versions.find((v) => v.id === id) : undefined)
  const selected = find(selectedId) ?? head
  const to = find(toId) ?? selected
  const from = find(fromId) ?? find(to?.parentId ?? null) ?? to
  const diff = useMemo(() => (from && to ? sideBySide(from.code, to.code) : null), [from, to])
  const paramChange =
    from && to && from.id !== to.id ? describeParamChanges(effectiveValues(from.code, from.params), effectiveValues(to.code, to.params)) : null
  const preview = usePreviewRender(createWorker, selected ?? null, project?.enabledLibraries ?? [])

  useEffect(() => {
    setDetails(NO_DETAILS)
    if (!selected) return
    let live = true
    void Promise.all([messagesForVersion(selected.id), usageForVersion(selected.id)]).then(([messages, usage]) => {
      if (!live) return
      const reply = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? null
      const tokens = usage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0)
      const known = usage.filter((u) => u.cost !== null)
      setDetails({ reply, tokens, cost: known.length > 0 ? known.reduce((n, u) => n + u.cost!, 0) : null })
    })
    return () => {
      live = false
    }
  }, [selected?.id])

  if (!project || !selected) {
    return <p className="pc-caption p-6">Open a project to see its versions.</p>
  }

  const now = Date.now()
  const isHead = selected.id === head?.id
  const age = formatAge(now - selected.createdAt)
  const meta = [
    selected.model,
    age === 'now' ? 'just now' : `${age} ago`,
    selected.renderMs !== null ? `rendered in ${Math.round(selected.renderMs)} ms` : null,
    details.tokens > 0 ? `${formatTokens(details.tokens)} · ${formatCost(details.cost)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const select = (id: string) => {
    setSelectedId(id)
    setFromId(null)
    setToId(null)
  }
  const leave = () => useAppStore.getState().setView('workbench')

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-[360px_minmax(0,1fr)_400px] md:overflow-hidden">
      <section aria-label="Versions" className="flex min-h-0 min-w-0 flex-col bg-panel">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="pc-label">Versions</span>
          <span className="flex-1" />
          <span className="pc-caption">{timelineCaption(timeline)}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-2">
          {timeline.rows.map(({ version, branch, isHead: current, variantsNotPicked }) => {
            const Icon = SOURCE_ICON[version.source]
            const failed = version.compileStatus === 'error'
            return (
              <Fragment key={version.id}>
                <button
                  type="button"
                  className={`pc-version${failed ? ' is-failed' : ''}${branch ? ' is-branch' : ''}`}
                  aria-current={version.id === selected.id ? 'true' : undefined}
                  onClick={() => select(version.id)}
                >
                  <VersionThumb version={version} />
                  <span className="pc-version-text">
                    <span className="t">
                      <Icon className="pc-i" aria-hidden="true" />
                      {version.label}
                      {current ? ' · current' : ''}
                    </span>
                    <span className="m">{failed ? `Failed · ${version.message}` : version.message}</span>
                  </span>
                  <span className="pc-caption">{formatAge(now - version.createdAt)}</span>
                </button>
                {variantsNotPicked > 0 && (
                  <span className="pc-caption pl-[68px]">
                    + {variantsNotPicked} variant{variantsNotPicked === 1 ? '' : 's'} not picked
                  </span>
                )}
              </Fragment>
            )
          })}
        </div>
        <div className="pc-row shrink-0 border-t border-line p-3">
          <button type="button" className="pc-btn is-sm flex-1" onClick={() => void saveProjectFile(project.id)}>
            Export project (.json)
          </button>
        </div>
      </section>

      <section aria-label="Compare" className="flex min-h-0 min-w-0 flex-col border-line bg-panel md:border-l">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="pc-label">Compare</span>
          <select className="pc-select h-(--control-sm) text-[13px]" aria-label="From version" value={from?.id ?? ''} onChange={(e) => setFromId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="pc-muted">→</span>
          <select className="pc-select h-(--control-sm) text-[13px]" aria-label="To version" value={to?.id ?? ''} onChange={(e) => setToId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="flex-1" />
          <span className="pc-caption pc-mono text-ok" data-testid="diff-added">
            +{diff?.added ?? 0}
          </span>
          <span className="pc-caption pc-mono text-error" data-testid="diff-removed">
            −{diff?.removed ?? 0}
          </span>
        </div>
        {paramChange && paramChange !== 'Parameters unchanged' && (
          <p className="pc-caption border-b border-line px-3 py-2" data-testid="param-diff">
            Parameters: {paramChange}
          </p>
        )}
        {diff && <DiffView rows={diff.rows} />}
      </section>

      <section aria-label="Preview" className="flex min-h-0 min-w-0 flex-col overflow-auto border-line bg-panel md:border-l">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="pc-label">Preview · {selected.label}</span>
          <span className="flex-1" />
          <span className="pc-caption">{isHead ? 'current version' : 'not the current version'}</span>
        </div>
        <div className="h-80 shrink-0">
          <Viewer mesh={preview.mesh} stale={false} />
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="pc-stack gap-1">
            <span className="font-semibold">
              {selected.label} · {SOURCE_NAME[selected.source]}
            </span>
            <span className="pc-caption" data-testid="preview-meta">
              {meta}
            </span>
          </div>
          {preview.status === 'error' && (
            <div className="pc-callout is-error">
              <IconX className="pc-i" aria-hidden="true" />
              <div className="pc-callout-body">
                <strong>This version does not compile</strong>
                {preview.error}
              </div>
            </div>
          )}
          <div className="pc-msg-body rounded-md border border-line bg-inset px-3 py-2" data-testid="preview-message">
            {details.reply ?? selected.message}
          </div>
          <div className="pc-row">
            <button
              type="button"
              className="pc-btn is-primary"
              disabled={isHead}
              onClick={() => void useProjectStore.getState().restore(selected.id).then(leave)}
            >
              <IconRestore className="pc-i" aria-hidden="true" />
              Restore {selected.label}
            </button>
            <button type="button" className="pc-btn" disabled={isHead} onClick={() => void useProjectStore.getState().branchFrom(selected.id).then(leave)}>
              Branch from here
            </button>
          </div>
          <span className="pc-caption">Restoring makes a new version. Nothing is deleted.</span>
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/history && npm run typecheck`
Expected: PASS (4 + 1 + 6 new tests and the earlier history tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/history/timeline.ts src/history/timeline.test.ts src/history/DiffView.tsx src/ui/Glyph.tsx src/history/VersionThumb.tsx src/history/usePreviewRender.ts src/history/usePreviewRender.test.ts src/history/HistoryView.tsx src/history/HistoryView.test.tsx
git commit -m "feat(history): History view with version tree, side-by-side compare, live preview, restore and branch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Header controls: project menu, undo and redo, History, "from v3"

**Files:**
- Create: `src/history/renderedVersion.ts`, `src/workbench/ProjectMenu.tsx`, `src/workbench/HistoryControls.tsx`, `src/workbench/useUndoShortcuts.ts`, `src/workbench/RenderedFromCaption.tsx`
- Test: `src/workbench/header.test.tsx`

**Interfaces:**
- Consumes: `useProjectStore` (`project`, `recent`, `head`, `versions`, `redoStack`, `newProject`, `openProject`, `renameProject`, `deleteProject`, `undo`, `redo`, Task 9); `useAppStore` (`view`, `setView`, `renderedCode`, `renderedParams`, Task 3); `DEFAULT_CODE` (M1); `saveProjectFile`, `importFromText` (Task 16); `paramOverrides` (Task 2); `paramsEqual` (Task 2); icons (Task 14).
- Produces:
  - `src/history/renderedVersion.ts`: `renderedVersionLabel(versions: Version[], head: Version | null, renderedCode: string | null, renderedParams: Params | null): string | null` (the nearest version on the head's ancestry, else any version, whose code and overrides produced the visible mesh); `useRenderedVersionLabel(): string | null`.
  - `src/workbench/RenderedFromCaption.tsx`: `RenderedFromCaption()`: "from v3" (screen CompileError), or M1's "last model that compiled" when no version matches.
  - `src/workbench/ProjectMenu.tsx`: `ProjectMenu()`: the header project button (name + chevron, `aria-haspopup="menu"`) and its menu: New project, Rename…, Examples, Export project (.json), Import project (.json)…, Recent projects, Delete project… (with an inline confirmation). Import errors show in a `pc-callout is-error` that names the field. Escape and a click outside close it.
  - `src/workbench/HistoryControls.tsx`: `HistoryControls()`: Undo and Redo icon buttons (disabled at the root / with nothing to redo) and the History toggle (`aria-pressed`, accent border when on).
  - `src/workbench/useUndoShortcuts.ts`: `isEditableTarget(target: EventTarget | null): boolean`; `useUndoShortcuts(): void`: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo, ignored inside the code editor and form fields (CodeMirror keeps its own undo).

- [ ] **Step 1: Write the failing test**

`src/workbench/header.test.tsx`:

```tsx
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { Version } from '../db/db'
import { importFromText, saveProjectFile } from '../history/projectFile'
import { useProjectStore } from '../history/projectStore'
import { renderedVersionLabel } from '../history/renderedVersion'
import { DEFAULT_CODE, useAppStore } from '../state/store'
import { makeProject, makeVersion } from '../test/fixtures'
import { HistoryControls } from './HistoryControls'
import { ProjectMenu } from './ProjectMenu'
import { RenderedFromCaption } from './RenderedFromCaption'
import { isEditableTarget, useUndoShortcuts } from './useUndoShortcuts'

vi.mock('../history/projectFile', () => ({
  saveProjectFile: vi.fn(async () => {}),
  importFromText: vi.fn(async () => ({ ok: false, error: 'versions[2].code must be text' })),
}))

const actions = {
  newProject: vi.fn(async () => makeProject()),
  openProject: vi.fn(async () => {}),
  renameProject: vi.fn(async () => {}),
  deleteProject: vi.fn(async () => {}),
  undo: vi.fn(async () => {}),
  redo: vi.fn(async () => {}),
}

const v1 = makeVersion({ id: 'v1', label: 'v1', code: 'w = 1; // [0:9]\ncube(w);' })
const v2 = makeVersion({ id: 'v2', label: 'v2', parentId: 'v1', code: 'w = 1; // [0:9]\ncube(w);', params: { w: 5 } })
const v3 = makeVersion({ id: 'v3', label: 'v3', parentId: 'v2', code: 'broken(' })

beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockClear())
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState({
    project: makeProject({ id: 'p1', name: '18650 holder' }),
    recent: [makeProject({ id: 'p1', name: '18650 holder' }), makeProject({ id: 'p2', name: 'Cable clip' })],
    versions: [v1, v2, v3],
    head: v3,
    redoStack: [],
    ...actions,
  })
})

describe('ProjectMenu', () => {
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /18650 holder/ }))

  it('shows the project name and opens a menu with the project actions and recent projects', () => {
    render(<ProjectMenu />)
    expect(screen.getByRole('button', { name: /18650 holder/ })).toHaveAttribute('aria-expanded', 'false')
    openMenu()
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'New project', 'Rename…', 'Examples', 'Export project (.json)', 'Import project (.json)…', 'Cable clip', 'Delete project…',
    ])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('starts a new project from the default model and returns to the workbench', async () => {
    useAppStore.getState().setView('history')
    render(<ProjectMenu />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New project' }))
    await waitFor(() => expect(actions.newProject).toHaveBeenCalledWith({ code: DEFAULT_CODE, origin: 'blank' }))
    expect(useAppStore.getState().view).toBe('workbench')
  })

  it('renames, opens a recent project, opens the examples and exports', async () => {
    render(<ProjectMenu />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Cell holder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(actions.renameProject).toHaveBeenCalledWith('Cell holder'))

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cable clip' }))
    await waitFor(() => expect(actions.openProject).toHaveBeenCalledWith('p2'))

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export project (.json)' }))
    expect(saveProjectFile).toHaveBeenCalledWith('p1')

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Examples' }))
    expect(useAppStore.getState().view).toBe('gallery')
  })

  it('asks before deleting, then deletes', async () => {
    render(<ProjectMenu />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project…' }))
    expect(screen.getByText('Delete “18650 holder”?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    await waitFor(() => expect(actions.deleteProject).toHaveBeenCalledWith('p1'))
  })

  it('shows why an import failed, naming the field', async () => {
    render(<ProjectMenu />)
    openMenu()
    const file = new File(['{"format":"chatscad-project"}'], 'bad.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Project file'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't import bad.jsonversions[2].code must be text")
    expect(importFromText).toHaveBeenCalledWith('{"format":"chatscad-project"}')
  })

  it('opens the first imported project', async () => {
    vi.mocked(importFromText).mockResolvedValueOnce({ ok: true, projects: [makeProject({ id: 'p9' })] })
    render(<ProjectMenu />)
    openMenu()
    fireEvent.change(screen.getByLabelText('Project file'), { target: { files: [new File(['{}'], 'ok.json')] } })
    await waitFor(() => expect(actions.openProject).toHaveBeenCalledWith('p9'))
  })
})

describe('HistoryControls and shortcuts', () => {
  it('undoes, redoes and toggles the History view', () => {
    render(<HistoryControls />)
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(actions.undo).toHaveBeenCalled()
    const history = screen.getByRole('button', { name: 'History' })
    fireEvent.click(history)
    expect(useAppStore.getState().view).toBe('history')
    expect(history).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(history)
    expect(useAppStore.getState().view).toBe('workbench')
  })

  it('disables Undo at the first version and enables Redo after an undo', () => {
    act(() => useProjectStore.setState({ head: v1, redoStack: ['v2'] }))
    render(<HistoryControls />)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
  })

  it('maps Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y outside the editor and form fields', () => {
    renderHook(() => useUndoShortcuts())
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'y', metaKey: true })
    expect(actions.undo).toHaveBeenCalledTimes(1)
    expect(actions.redo).toHaveBeenCalledTimes(2)

    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const line = document.createElement('div')
    editor.append(line)
    document.body.append(editor)
    fireEvent.keyDown(line, { key: 'z', ctrlKey: true })
    expect(actions.undo).toHaveBeenCalledTimes(1)
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableTarget(document.body)).toBe(false)
    editor.remove()
  })
})

describe('the version behind the visible model', () => {
  const versions: Version[] = [v1, v2, v3]

  it('finds the nearest version on the ancestry with the rendered code and overrides', () => {
    expect(renderedVersionLabel(versions, v3, v1.code, { w: 5 })).toBe('v2')
    expect(renderedVersionLabel(versions, v3, v1.code, {})).toBe('v1')
    expect(renderedVersionLabel(versions, v3, 'other', {})).toBeNull()
    expect(renderedVersionLabel(versions, null, v1.code, {})).toBeNull()
  })

  it('shows "from v2" next to the dims while the model is stale', () => {
    useAppStore.getState().renderFinished({ ok: true, mesh: { positions: new Float32Array(), normals: new Float32Array(), triangleCount: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }, stl: new ArrayBuffer(0), logs: [], diagnostics: [], renderMs: 1 }, v1.code, { w: 5 })
    const { rerender } = render(<RenderedFromCaption />)
    expect(screen.getByText('from v2')).toBeInTheDocument()
    act(() => useProjectStore.setState({ versions: [], head: null }))
    rerender(<RenderedFromCaption />)
    expect(screen.getByText('last model that compiled')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workbench/header.test.tsx`
Expected: FAIL with "Failed to resolve import '../history/renderedVersion'".

- [ ] **Step 3: Write minimal implementation**

`src/history/renderedVersion.ts`:

```ts
import { useMemo } from 'react'
import type { Version } from '../db/db'
import { paramsEqual, type Params } from '../render/params'
import { paramOverrides } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { useProjectStore } from './projectStore'

export function renderedVersionLabel(
  versions: Version[],
  head: Version | null,
  renderedCode: string | null,
  renderedParams: Params | null,
): string | null {
  if (!head || renderedCode === null) return null
  const overrides = paramOverrides(renderedCode, renderedParams ?? {})
  const matches = (v: Version) => v.code === renderedCode && paramsEqual(v.params, overrides) && v.compileStatus !== 'error'
  const byId = new Map(versions.map((v) => [v.id, v]))
  const seen = new Set<string>()
  for (let v: Version | undefined = head; v && !seen.has(v.id); v = v.parentId ? byId.get(v.parentId) : undefined) {
    seen.add(v.id)
    if (matches(v)) return v.label
  }
  return [...versions].reverse().find(matches)?.label ?? null
}

export function useRenderedVersionLabel(): string | null {
  const versions = useProjectStore((s) => s.versions)
  const head = useProjectStore((s) => s.head)
  const renderedCode = useAppStore((s) => s.renderedCode)
  const renderedParams = useAppStore((s) => s.renderedParams)
  return useMemo(() => renderedVersionLabel(versions, head, renderedCode, renderedParams), [versions, head, renderedCode, renderedParams])
}
```

`src/workbench/RenderedFromCaption.tsx`:

```tsx
import { useRenderedVersionLabel } from '../history/renderedVersion'

/** Next to the dims while the model on screen is the last one that compiled (screen CompileError: "from v3"). */
export function RenderedFromCaption() {
  const label = useRenderedVersionLabel()
  return <span className="pc-caption">{label ? `from ${label}` : 'last model that compiled'}</span>
}
```

`src/workbench/HistoryControls.tsx`:

```tsx
import { useProjectStore } from '../history/projectStore'
import { useAppStore } from '../state/store'
import { IconHistory, IconRedo, IconUndo } from '../ui/icons'

export function HistoryControls() {
  const view = useAppStore((s) => s.view)
  const canUndo = useProjectStore((s) => Boolean(s.head?.parentId))
  const canRedo = useProjectStore((s) => s.redoStack.length > 0)
  const inHistory = view === 'history'
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="pc-btn is-ghost is-sm is-icon"
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={() => void useProjectStore.getState().undo()}
      >
        <IconUndo className="pc-i" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pc-btn is-ghost is-sm is-icon"
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={() => void useProjectStore.getState().redo()}
      >
        <IconRedo className="pc-i" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`pc-btn is-sm ${inHistory ? 'border-accent' : 'is-ghost'}`}
        aria-pressed={inHistory}
        onClick={() => useAppStore.getState().setView(inHistory ? 'workbench' : 'history')}
      >
        <IconHistory className="pc-i" aria-hidden="true" />
        History
      </button>
    </div>
  )
}
```

`src/workbench/useUndoShortcuts.ts`:

```ts
import { useEffect } from 'react'
import { useProjectStore } from '../history/projectStore'

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.cm-editor, input, textarea, select, [contenteditable="true"]') !== null
}

/** Version undo/redo outside the editor; inside it, CodeMirror's own undo handles keystrokes. */
export function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditableTarget(e.target)) return
      const key = e.key.toLowerCase()
      const redo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)
      const undo = key === 'z' && !e.shiftKey
      if (!undo && !redo) return
      e.preventDefault()
      void (redo ? useProjectStore.getState().redo() : useProjectStore.getState().undo())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
```

`src/workbench/ProjectMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { importFromText, saveProjectFile } from '../history/projectFile'
import { useProjectStore } from '../history/projectStore'
import { DEFAULT_CODE, useAppStore } from '../state/store'
import { IconChevronDown, IconGallery, IconImport, IconPlus, IconX } from '../ui/icons'

type Mode = 'menu' | 'rename' | 'delete'

const item = 'pc-btn is-ghost is-sm w-full justify-start'

export function ProjectMenu() {
  const project = useProjectStore((s) => s.project)
  const recent = useProjectStore((s) => s.recent)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('menu')
  const [name, setName] = useState('')
  const [importError, setImportError] = useState<{ file: string; error: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const close = () => {
    setOpen(false)
    setMode('menu')
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => rootRef.current && !rootRef.current.contains(e.target as Node) && close()
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  if (!project) return null
  const store = () => useProjectStore.getState()
  const toWorkbench = () => useAppStore.getState().setView('workbench')
  const others = recent.filter((p) => p.id !== project.id)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const result = await importFromText(await file.text())
    if (fileRef.current) fileRef.current.value = ''
    if (!result.ok) {
      setImportError({ file: file.name, error: result.error })
      return
    }
    setImportError(null)
    close()
    await store().openProject(result.projects[0]!.id)
    toWorkbench()
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="inline-flex h-(--control-sm) items-center gap-1 rounded-sm px-2 text-[14px] font-semibold text-ink hover:bg-panel-raised"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {project.name}
        <IconChevronDown className="pc-i" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Project" className="absolute top-full left-0 z-20 mt-1 flex w-72 flex-col gap-1 rounded-lg border border-line bg-panel-raised p-2 shadow-pop">
          {mode === 'menu' && (
            <>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close()
                  void store().newProject({ code: DEFAULT_CODE, origin: 'blank' }).then(toWorkbench)
                }}
              >
                <IconPlus className="pc-i" aria-hidden="true" />
                New project
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setName(project.name)
                  setMode('rename')
                }}
              >
                Rename…
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close()
                  useAppStore.getState().setView('gallery')
                }}
              >
                <IconGallery className="pc-i" aria-hidden="true" />
                Examples
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close()
                  void saveProjectFile(project.id)
                }}
              >
                Export project (.json)
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => fileRef.current?.click()}>
                <IconImport className="pc-i" aria-hidden="true" />
                Import project (.json)…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Project file"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              {others.length > 0 && <span className="pc-label px-2 pt-2">Recent</span>}
              {others.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => {
                    close()
                    void store().openProject(p.id).then(toWorkbench)
                  }}
                >
                  {p.name}
                </button>
              ))}
              <button type="button" role="menuitem" className={`${item} text-error`} onClick={() => setMode('delete')}>
                Delete project…
              </button>
              {importError && (
                <div className="pc-callout is-error" role="alert">
                  <IconX className="pc-i" aria-hidden="true" />
                  <div className="pc-callout-body">
                    <strong>Couldn't import {importError.file}</strong>
                    {importError.error}
                  </div>
                </div>
              )}
            </>
          )}
          {mode === 'rename' && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                close()
                void store().renameProject(name)
              }}
            >
              <div className="pc-field">
                <label htmlFor="project-name">Project name</label>
                <div className="pc-input">
                  <input id="project-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </div>
              </div>
              <div className="pc-dialog-actions">
                <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
                <button type="submit" className="pc-btn is-sm is-primary" disabled={name.trim() === ''}>
                  Rename
                </button>
              </div>
            </form>
          )}
          {mode === 'delete' && (
            <div className="flex flex-col gap-2 p-1">
              <strong>Delete “{project.name}”?</strong>
              <p className="pc-caption">This removes its versions, chat and presets from this browser. Export it first if you want a copy.</p>
              <div className="pc-dialog-actions">
                <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="pc-btn is-sm is-danger"
                  onClick={() => {
                    close()
                    void store().deleteProject(project.id)
                  }}
                >
                  Delete project
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workbench && npm run typecheck`
Expected: PASS (11 new tests plus Task 15's), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/history/renderedVersion.ts src/workbench/ProjectMenu.tsx src/workbench/HistoryControls.tsx src/workbench/useUndoShortcuts.ts src/workbench/RenderedFromCaption.tsx src/workbench/header.test.tsx
git commit -m "feat(workbench): project menu, undo and redo, History toggle and the from-version caption

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Eight parametric gallery examples, rendered in CI

**Files:**
- Create: `src/gallery/examples/box-with-lid.scad`, `enclosure.scad`, `l-bracket.scad`, `knob.scad`, `spur-gear.scad`, `print-in-place-hinge.scad`, `cable-clip.scad`, `phone-stand.scad`; `src/gallery/index.ts`
- Test: `src/gallery/index.test.ts`, `src/gallery/examples.wasm.test.ts`

**Interfaces:**
- Consumes: `parseCustomizer` (Task 2); `GlyphShape` (Task 17); `runOpenSCAD` (Task 5); `nodeOpenSCADFactory` (Task 5); `formatDimParts` (M1).
- Produces (`src/gallery/index.ts`): `type GalleryCategory = 'Storage' | 'Mounting' | 'Mechanical' | 'Desk'`; `CATEGORIES: GalleryCategory[]`; `interface GalleryExample { id: string; name: string; tags: string[]; category: GalleryCategory; glyph: GlyphShape[]; code: string }`; `EXAMPLES: GalleryExample[]` (screen order). Code is imported with Vite's `?raw`, so each example is a plain `.scad` file in the bundle and works offline.

Every example is in millimetres, uses named modules, puts every tunable dimension in a top-level annotated parameter with a description, groups them with `/* [Group] */`, and keeps helpers under `/* [Hidden] */`. Their visible parameter counts match the Gallery screen (6, 9, 7, 5, 6, 5, 4, 4). All eight were rendered with the pinned OpenSCAD 2026.10.08 WASM and the Manifold backend at their defaults and with every slider at its minimum and at its maximum while writing this plan; the WASM test below keeps that true in CI.

- [ ] **Step 1: Write the failing tests**

`src/gallery/index.test.ts`:

```ts
import { parseCustomizer } from '../scad/customizer'
import { CATEGORIES, EXAMPLES } from './index'

it('ships the eight examples from the Gallery screen, in its order, with its parameter counts and tags', () => {
  expect(EXAMPLES.map((e) => [e.name, parseCustomizer(e.code).length, e.category, e.tags.join(' / ')])).toEqual([
    ['Box with lid', 6, 'Storage', 'storage / snap-fit'],
    ['Enclosure', 9, 'Storage', 'electronics / screw bosses'],
    ['L bracket', 7, 'Mounting', 'mounting / M3 / M4'],
    ['Knob', 5, 'Mechanical', 'D-shaft / knurled'],
    ['Spur gear', 6, 'Mechanical', 'mechanical / module 1'],
    ['Print-in-place hinge', 5, 'Mechanical', 'mechanical / no supports'],
    ['Cable clip', 4, 'Desk', 'desk / adhesive'],
    ['Phone stand', 4, 'Desk', 'desk / angle'],
  ])
  expect(CATEGORIES).toEqual(['Storage', 'Mounting', 'Mechanical', 'Desk'])
  expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(8)
})

it('describes and annotates every parameter, groups them, and needs no library', () => {
  for (const example of EXAMPLES) {
    const params = parseCustomizer(example.code)
    for (const p of params) {
      expect(p.description, `${example.id}: ${p.name}`).not.toBe('')
      expect(p.group, `${example.id}: ${p.name}`).not.toBe('')
      if (p.control.kind === 'number') throw new Error(`${example.id}: ${p.name} has no annotation`)
    }
    expect(example.code).not.toMatch(/^\s*(include|use)\s*</m)
    expect(example.code).toMatch(/^module \w+\(/m)
    expect(example.glyph.length).toBeGreaterThanOrEqual(3)
  }
})
```

`src/gallery/examples.wasm.test.ts`:

```ts
// @vitest-environment node
import { formatDimParts } from '../render/dims'
import { runOpenSCAD, type OpenSCADFactory } from '../render/runOpenSCAD'
import { parseCustomizer } from '../scad/customizer'
import { nodeOpenSCADFactory } from '../test/openscadNode'
import { EXAMPLES } from './index'

let factory: OpenSCADFactory
beforeAll(async () => {
  factory = await nodeOpenSCADFactory()
})

const sliderValues = (code: string, end: 'min' | 'max') =>
  Object.fromEntries(parseCustomizer(code).flatMap((p) => (p.control.kind === 'slider' ? [[p.name, p.control[end]]] : [])))

describe.each(EXAMPLES.map((e) => [e.name, e] as const))('%s', (_name, example) => {
  it('renders at its defaults in the real OpenSCAD WASM with a printable size', async () => {
    const r = await runOpenSCAD(factory, { code: example.code })
    if (!r.ok) throw new Error(`${example.id}: ${r.error}\n${r.logs.map((l) => l.text).join('\n')}`)
    expect(r.mesh.triangleCount).toBeGreaterThan(0)
    for (const size of formatDimParts(r.mesh.bounds).map(Number)) {
      expect(size).toBeGreaterThan(1)
      expect(size).toBeLessThan(400)
    }
    expect(r.logs.filter((l) => /^(WARNING|ERROR)/.test(l.text))).toEqual([])
  }, 60_000)

  it.each(['min', 'max'] as const)('renders with every slider at its %s', async (end) => {
    const r = await runOpenSCAD(factory, { code: example.code, params: sliderValues(example.code, end) })
    expect(r.ok ? 'ok' : r.error).toBe('ok')
  }, 60_000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/gallery`
Expected: FAIL with "Failed to resolve import './index'".

- [ ] **Step 3: Write the examples and the index**

`src/gallery/examples/box-with-lid.scad`:

```scad
// Box with lid
// An open box and a lid with an insert lip, printed side by side.

/* [Box] */
// Inside width (mm)
inner_width = 60; // [20:1:200]
// Inside depth (mm)
inner_depth = 40; // [20:1:200]
// Inside height (mm)
inner_height = 30; // [10:1:150]
// Wall thickness (mm)
wall = 2; // [1.2:0.2:5]

/* [Lid] */
// Height of the lip that sits inside the box (mm)
lip_height = 4; // [2:0.5:10]
// Gap between the lip and the box wall (mm)
clearance = 0.2; // [0:0.05:0.6]

/* [Hidden] */
gap = 10;
outer_width = inner_width + 2 * wall;
outer_depth = inner_depth + 2 * wall;

module box() {
  difference() {
    cube([outer_width, outer_depth, inner_height + wall]);
    translate([wall, wall, wall])
      cube([inner_width, inner_depth, inner_height + 1]);
  }
}

module lid() {
  lip_width = inner_width - 2 * clearance;
  lip_depth = inner_depth - 2 * clearance;
  cube([outer_width, outer_depth, wall]);
  translate([wall + clearance, wall + clearance, wall - 0.01])
    difference() {
      cube([lip_width, lip_depth, lip_height]);
      translate([wall, wall, -1])
        cube([lip_width - 2 * wall, lip_depth - 2 * wall, lip_height + 2]);
    }
}

box();
translate([outer_width + gap, 0, 0]) lid();
```

`src/gallery/examples/enclosure.scad`:

```scad
// Enclosure
// An open electronics case with four screw standoffs for a PCB.

/* [PCB] */
// PCB width (mm)
pcb_width = 70; // [20:1:200]
// PCB depth (mm)
pcb_depth = 50; // [20:1:200]
// Space between the PCB and the walls (mm)
pcb_gap = 2; // [0.5:0.5:10]
// Height of the standoffs under the PCB (mm)
standoff_height = 5; // [2:0.5:20]

/* [Case] */
// Inside height above the floor (mm)
inner_height = 25; // [10:1:100]
// Wall thickness (mm)
wall = 2; // [1.2:0.2:5]
// Floor thickness (mm)
floor_thickness = 2; // [1:0.2:5]

/* [Screws] */
// Standoff outer diameter (mm)
boss_diameter = 6; // [4:0.5:12]
// Screw pilot hole diameter (mm)
screw_hole = 2.5; // [1.5:0.1:4]

/* [Hidden] */
hole_inset = 3.5;
$fn = 40;
inner_width = pcb_width + 2 * pcb_gap;
inner_depth = pcb_depth + 2 * pcb_gap;

module shell() {
  difference() {
    cube([inner_width + 2 * wall, inner_depth + 2 * wall, floor_thickness + inner_height]);
    translate([wall, wall, floor_thickness])
      cube([inner_width, inner_depth, inner_height + 1]);
  }
}

module standoff() {
  difference() {
    cylinder(h = standoff_height, d = boss_diameter);
    translate([0, 0, -1]) cylinder(h = standoff_height + 2, d = screw_hole);
  }
}

module standoffs() {
  for (x = [hole_inset, pcb_width - hole_inset], y = [hole_inset, pcb_depth - hole_inset])
    translate([wall + pcb_gap + x, wall + pcb_gap + y, floor_thickness - 0.01])
      standoff();
}

shell();
standoffs();
```

`src/gallery/examples/l-bracket.scad`:

```scad
// L bracket
// A right-angle bracket with screw holes in both legs.

/* [Size] */
// Bracket width (mm)
width = 30; // [10:1:100]
// Length of the floor leg (mm)
leg_a = 40; // [15:1:150]
// Height of the wall leg (mm)
leg_b = 30; // [15:1:150]
// Plate thickness (mm)
thickness = 4; // [2:0.5:10]

/* [Holes] */
// Screw size
screw = 3.4; // [3.4:M3, 4.5:M4]
// Holes in each leg
holes_per_leg = 2; // [1:1:4]
// Add stiffening ribs on both sides
gusset = true;

/* [Hidden] */
rib = 3;
$fn = 32;

module plate() {
  cube([leg_a, width, thickness]);
  cube([thickness, width, leg_b]);
}

module holes() {
  for (i = [1:holes_per_leg]) {
    translate([thickness + (leg_a - thickness) * i / (holes_per_leg + 1), width / 2, -1])
      cylinder(h = thickness + 2, d = screw);
    translate([-1, width / 2, thickness + (leg_b - thickness) * i / (holes_per_leg + 1)])
      rotate([0, 90, 0]) cylinder(h = thickness + 2, d = screw);
  }
}

module rib_at(y) {
  size = min(leg_a, leg_b) - thickness;
  translate([thickness - 0.01, y + rib, thickness - 0.01])
    rotate([90, 0, 0])
      linear_extrude(height = rib)
        polygon([[0, 0], [size * 0.6, 0], [0, size * 0.6]]);
}

difference() {
  union() {
    plate();
    if (gusset) {
      rib_at(0);
      rib_at(width - rib);
    }
  }
  holes();
}
```

`src/gallery/examples/knob.scad`:

```scad
// Knob
// A ridged knob for a D-shaft potentiometer or encoder.

/* [Knob] */
// Outer diameter (mm)
diameter = 30; // [12:1:80]
// Height (mm)
height = 15; // [6:1:40]
// Number of grip ridges
grip_ridges = 24; // [8:1:60]

/* [Shaft] */
// Shaft diameter (mm)
shaft_diameter = 6; // [3:0.1:10]
// Depth of the flat on the D-shaft (mm)
flat_depth = 1.5; // [0:0.1:3]

/* [Hidden] */
clearance = 0.2;
top = 3;
$fn = 64;

module body() {
  ridge = diameter * PI / grip_ridges / 2;
  difference() {
    cylinder(h = height, d = diameter);
    for (i = [0:grip_ridges - 1])
      rotate([0, 0, i * 360 / grip_ridges])
        translate([diameter / 2, 0, -1])
          cylinder(h = height + 2, d = ridge, $fn = 12);
  }
}

module shaft_hole() {
  d = shaft_diameter + clearance;
  translate([0, 0, -1])
    intersection() {
      cylinder(h = height - top + 1, d = d);
      translate([-d, -d, -1])
        cube([2 * d, d + d / 2 - flat_depth, height + 2]);
    }
}

difference() {
  body();
  shaft_hole();
}
```

`src/gallery/examples/spur-gear.scad`:

```scad
// Spur gear
// An involute spur gear with a round bore.

/* [Gear] */
// Number of teeth
teeth = 20; // [8:1:80]
// Gear module: pitch diameter divided by teeth (mm)
gear_module = 1; // [0.5:0.25:4]
// Pressure angle (degrees)
pressure_angle = 20; // [14.5, 20, 25]
// Thickness (mm)
thickness = 6; // [2:0.5:30]

/* [Fit] */
// Bore diameter (mm)
bore = 5; // [0:0.5:30]
// Backlash per tooth (mm)
backlash = 0.1; // [0:0.05:0.5]

/* [Hidden] */
steps = 8;
$fn = 64;

pitch_r = teeth * gear_module / 2;
base_r = pitch_r * cos(pressure_angle);
outer_r = pitch_r + gear_module;
root_r = pitch_r - 1.25 * gear_module;
start_r = max(base_r, root_r);
half_tooth = ((PI * gear_module / 2 - backlash) / 2) / pitch_r * 180 / PI;

// Involute function, angle in degrees, result in radians.
function inv(a) = tan(a) - a * PI / 180;
// Half-width angle of the tooth (degrees) at radius r.
function flank(r) = max(half_tooth + (inv(pressure_angle) - inv(acos(min(1, base_r / r)))) * 180 / PI, 0.2);
function polar(r, a) = [r * cos(a), r * sin(a)];

module tooth() {
  rise = [for (i = [0:steps]) start_r + (outer_r - start_r) * i / steps];
  polygon(concat(
    [[0, 0]],
    [for (r = rise) polar(r, -flank(r))],
    [for (i = [steps:-1:0]) polar(rise[i], flank(rise[i]))]
  ));
}

module gear_2d() {
  difference() {
    union() {
      circle(r = root_r);
      for (i = [0:teeth - 1]) rotate(i * 360 / teeth) tooth();
    }
    if (bore > 0) circle(d = min(bore, 2 * root_r - 2 * gear_module));
  }
}

linear_extrude(height = thickness) gear_2d();
```

`src/gallery/examples/print-in-place-hinge.scad`:

```scad
// Print-in-place hinge
// Two leaves joined by alternating knuckles around a captive pin. Prints flat, no supports.

/* [Hinge] */
// Hinge length along the pin (mm)
hinge_length = 40; // [15:1:150]
// Length of each leaf (mm)
leaf_length = 20; // [8:1:80]
// Number of knuckles (odd)
knuckles = 5; // [3:2:11]

/* [Fit] */
// Pin diameter (mm)
pin_diameter = 3; // [2:0.5:8]
// Gap between moving parts (mm)
clearance = 0.4; // [0.2:0.05:0.8]

/* [Hidden] */
knuckle_wall = 1.6;
leaf_thickness = 2.4;
$fn = 48;

knuckle_d = pin_diameter + 2 * (clearance + knuckle_wall);
axis_z = knuckle_d / 2;
segment = hinge_length / knuckles;

module along_axis(x0, len, d) {
  translate([x0, 0, axis_z]) rotate([0, 90, 0]) cylinder(h = len, d = d);
}

// owner 0 is the leaf at negative Y and carries the pin; owner 1 is the leaf at positive Y.
module leaf(owner) {
  difference() {
    translate([0, owner == 0 ? -leaf_length : 0, 0])
      cube([hinge_length, leaf_length, leaf_thickness]);
    for (i = [0:knuckles - 1])
      if (i % 2 != owner)
        along_axis(i * segment - clearance, segment + 2 * clearance, knuckle_d + 2 * clearance);
  }
}

module knuckles_of(owner) {
  for (i = [0:knuckles - 1])
    if (i % 2 == owner)
      along_axis(i * segment + clearance / 2, segment - clearance, knuckle_d);
}

module side_a() {
  leaf(0);
  knuckles_of(0);
  along_axis(clearance / 2, hinge_length - clearance, pin_diameter);
}

module side_b() {
  difference() {
    union() {
      leaf(1);
      knuckles_of(1);
    }
    along_axis(-1, hinge_length + 2, pin_diameter + 2 * clearance);
  }
}

side_a();
side_b();
```

`src/gallery/examples/cable-clip.scad`:

```scad
// Cable clip
// Snap-in cable holders on a flat base for an adhesive pad.

/* [Clip] */
// Cable diameter (mm)
cable_diameter = 6; // [2:0.5:15]
// Number of cables
cable_count = 2; // [1:1:6]
// Clip width along the cable (mm)
clip_width = 10; // [5:1:30]
// Base thickness (mm)
base_thickness = 2; // [1:0.2:5]

/* [Hidden] */
wall = 1.6;
opening = 0.75;
$fn = 48;

pitch = cable_diameter + 2 * wall;

module ring() {
  difference() {
    circle(d = cable_diameter + 2 * wall);
    circle(d = cable_diameter);
    translate([-cable_diameter * opening / 2, 0]) square([cable_diameter * opening, cable_diameter]);
  }
}

module clips() {
  for (i = [0:cable_count - 1])
    translate([wall + pitch / 2 + i * pitch, clip_width, base_thickness + cable_diameter / 2])
      rotate([90, 0, 0]) linear_extrude(height = clip_width) ring();
}

module base() {
  cube([cable_count * pitch + 2 * wall, clip_width, base_thickness]);
}

base();
clips();
```

`src/gallery/examples/phone-stand.scad`:

```scad
// Phone stand
// A desk stand that holds a phone at a fixed viewing angle.

/* [Stand] */
// Viewing angle from the desk (degrees)
angle = 65; // [45:1:80]
// Phone thickness including the case (mm)
phone_thickness = 12; // [6:0.5:20]
// Stand width (mm)
width = 70; // [30:1:150]
// Front lip height (mm)
lip_height = 12; // [5:1:30]

/* [Hidden] */
t = 4;
rest_length = 90;
$fn = 32;

rest_start = [t + phone_thickness, t];
rest_end = rest_start + rest_length * [cos(angle), sin(angle)];
base_length = rest_end[0] + 20;

module profile() {
  square([base_length, t]);
  square([t, lip_height + t]);
  translate(rest_start) rotate(angle) translate([0, -t]) square([rest_length, t]);
  hull() {
    translate(rest_end) circle(d = t);
    translate([base_length - t / 2, t / 2]) circle(d = t);
  }
}

rotate([90, 0, 0]) translate([0, 0, -width]) linear_extrude(height = width) profile();
```

`src/gallery/index.ts`:

```ts
import type { GlyphShape } from '../ui/Glyph'
import boxWithLid from './examples/box-with-lid.scad?raw'
import cableClip from './examples/cable-clip.scad?raw'
import enclosure from './examples/enclosure.scad?raw'
import knob from './examples/knob.scad?raw'
import lBracket from './examples/l-bracket.scad?raw'
import phoneStand from './examples/phone-stand.scad?raw'
import hinge from './examples/print-in-place-hinge.scad?raw'
import spurGear from './examples/spur-gear.scad?raw'

export type GalleryCategory = 'Storage' | 'Mounting' | 'Mechanical' | 'Desk'

export const CATEGORIES: GalleryCategory[] = ['Storage', 'Mounting', 'Mechanical', 'Desk']

export interface GalleryExample {
  id: string
  name: string
  tags: string[]
  category: GalleryCategory
  /** The iso line glyph from the Gallery screen (not a render). */
  glyph: GlyphShape[]
  code: string
}

const poly = (face: 'f-l' | 'f-r' | 'f-top', points: string): GlyphShape => ({ kind: 'polygon', face, points })
const hole = (cx: number, cy: number, rx: number, ry: number): GlyphShape => ({ kind: 'ellipse', face: 'f-hole', cx, cy, rx, ry })

/** To add an example: put a parametric .scad file in ./examples and an entry here; the tests render it in CI. */
export const EXAMPLES: GalleryExample[] = [
  {
    id: 'box-with-lid',
    name: 'Box with lid',
    tags: ['storage', 'snap-fit'],
    category: 'Storage',
    glyph: [poly('f-l', '14,36 50,54 50,82 14,64'), poly('f-r', '50,54 86,36 86,64 50,82'), poly('f-top', '50,18 86,36 50,54 14,36')],
    code: boxWithLid,
  },
  {
    id: 'enclosure',
    name: 'Enclosure',
    tags: ['electronics', 'screw bosses'],
    category: 'Storage',
    glyph: [
      poly('f-l', '8,46 50,66 50,78 8,58'),
      poly('f-r', '50,66 92,46 92,58 50,78'),
      poly('f-top', '50,26 92,46 50,66 8,46'),
      hole(36, 46, 8, 4),
      hole(64, 46, 8, 4),
    ],
    code: enclosure,
  },
  {
    id: 'l-bracket',
    name: 'L bracket',
    tags: ['mounting', 'M3', 'M4'],
    category: 'Mounting',
    glyph: [
      poly('f-l', '20,40 50,55 50,70 20,55'),
      poly('f-r', '50,55 80,40 80,55 50,70'),
      poly('f-top', '50,25 80,40 50,55 20,40'),
      poly('f-r', '56,30 74,21 74,6 56,15'),
    ],
    code: lBracket,
  },
  {
    id: 'knob',
    name: 'Knob',
    tags: ['D-shaft', 'knurled'],
    category: 'Mechanical',
    glyph: [poly('f-l', '26,30 50,42 50,88 26,76'), poly('f-r', '50,42 74,30 74,76 50,88'), poly('f-top', '50,18 74,30 50,42 26,30'), hole(50, 30, 8, 4)],
    code: knob,
  },
  {
    id: 'spur-gear',
    name: 'Spur gear',
    tags: ['mechanical', 'module 1'],
    category: 'Mechanical',
    glyph: [poly('f-l', '8,46 50,66 50,74 8,54'), poly('f-r', '50,66 92,46 92,54 50,74'), poly('f-top', '50,26 92,46 50,66 8,46'), hole(50, 46, 10, 5)],
    code: spurGear,
  },
  {
    id: 'print-in-place-hinge',
    name: 'Print-in-place hinge',
    tags: ['mechanical', 'no supports'],
    category: 'Mechanical',
    glyph: [
      poly('f-l', '14,46 50,64 50,72 14,54'),
      poly('f-r', '50,64 86,46 86,54 50,72'),
      poly('f-top', '50,28 86,46 50,64 14,46'),
      poly('f-top', '40,40 60,30 60,24 40,34'),
    ],
    code: hinge,
  },
  {
    id: 'cable-clip',
    name: 'Cable clip',
    tags: ['desk', 'adhesive'],
    category: 'Desk',
    glyph: [poly('f-l', '30,44 50,54 50,74 30,64'), poly('f-r', '50,54 70,44 70,64 50,74'), poly('f-top', '50,34 70,44 50,54 30,44'), hole(50, 44, 9, 4.5)],
    code: cableClip,
  },
  {
    id: 'phone-stand',
    name: 'Phone stand',
    tags: ['desk', 'angle'],
    category: 'Desk',
    glyph: [
      poly('f-l', '20,40 50,55 50,70 20,55'),
      poly('f-r', '50,55 80,40 80,55 50,70'),
      poly('f-top', '50,25 80,40 50,55 20,40'),
      poly('f-r', '44,34 62,25 62,4 44,13'),
    ],
    code: phoneStand,
  },
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/gallery && npm run typecheck`
Expected: PASS (2 index tests and 24 WASM tests: 8 examples × defaults, min and max), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/gallery/examples src/gallery/index.ts src/gallery/index.test.ts src/gallery/examples.wasm.test.ts
git commit -m "feat(gallery): eight parametric examples, rendered through the real OpenSCAD WASM in CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Gallery view

**Files:**
- Create: `src/gallery/GalleryView.tsx`
- Test: `src/gallery/GalleryView.test.tsx`

**Interfaces:**
- Consumes: `EXAMPLES`, `CATEGORIES`, `GalleryExample` (Task 19); `Glyph` (Task 17); `parseCustomizer` (Task 2); `useProjectStore.newProject` (Task 9); `useAppStore.setView` (Task 3); `IconSearch` (Task 14).
- Produces: `GalleryView()`: a full page (screen Gallery) with its own top bar ("Examples", Back to project), the heading "Start from a working model", search over names and tags, category tabs ("All 8", Storage, Mounting, Mechanical, Desk), `pc-variant` cards (glyph, name, "6 params", tags, Start from this) and the pull-request caption. Start from this → `newProject({ name, code, origin: 'gallery', source: 'gallery', message: 'Started from <name>' })`, then the workbench.

- [ ] **Step 1: Write the failing test**

`src/gallery/GalleryView.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useProjectStore } from '../history/projectStore'
import { useAppStore } from '../state/store'
import { makeProject } from '../test/fixtures'
import { GalleryView } from './GalleryView'
import { EXAMPLES } from './index'

const newProject = vi.fn(async () => makeProject())

beforeEach(() => {
  newProject.mockClear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.getState().setView('gallery')
  useProjectStore.setState({ newProject })
})

const cards = () => screen.getAllByRole('article')

it('shows every example with its glyph, parameter count and tags', () => {
  render(<GalleryView />)
  expect(screen.getByRole('heading', { name: 'Start from a working model' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'All 8' })).toHaveAttribute('aria-selected', 'true')
  expect(cards()).toHaveLength(8)
  const box = within(screen.getByRole('article', { name: 'Box with lid' }))
  expect(box.getByText('6 params')).toBeInTheDocument()
  expect(box.getByText('snap-fit')).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'Box with lid' }).querySelector('.pc-variant-view svg polygon')).not.toBeNull()
})

it('filters by category and by search over names and tags', () => {
  render(<GalleryView />)
  fireEvent.click(screen.getByRole('tab', { name: 'Desk' }))
  expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['Cable clip', 'Phone stand'])
  fireEvent.click(screen.getByRole('tab', { name: 'All 8' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search examples' }), { target: { value: 'no supports' } })
  expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['Print-in-place hinge'])
  fireEvent.change(screen.getByRole('textbox', { name: 'Search examples' }), { target: { value: 'zzz' } })
  expect(screen.getByText('No example matches “zzz”.')).toBeInTheDocument()
})

it('starts a new project from an example and opens the workbench', async () => {
  render(<GalleryView />)
  fireEvent.click(within(screen.getByRole('article', { name: 'Spur gear' })).getByRole('button', { name: 'Start from this' }))
  const gear = EXAMPLES.find((e) => e.id === 'spur-gear')!
  await waitFor(() =>
    expect(newProject).toHaveBeenCalledWith({ name: 'Spur gear', code: gear.code, origin: 'gallery', source: 'gallery', message: 'Started from Spur gear' }),
  )
  await waitFor(() => expect(useAppStore.getState().view).toBe('workbench'))
})

it('goes back to the project', () => {
  render(<GalleryView />)
  fireEvent.click(screen.getByRole('button', { name: 'Back to project' }))
  expect(useAppStore.getState().view).toBe('workbench')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/gallery/GalleryView.test.tsx`
Expected: FAIL with "Failed to resolve import './GalleryView'".

- [ ] **Step 3: Write minimal implementation**

`src/gallery/GalleryView.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useProjectStore } from '../history/projectStore'
import { parseCustomizer } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { Glyph } from '../ui/Glyph'
import { IconSearch } from '../ui/icons'
import { CATEGORIES, EXAMPLES, type GalleryCategory, type GalleryExample } from './index'

type Tab = GalleryCategory | 'All'

const toWorkbench = () => useAppStore.getState().setView('workbench')

export function GalleryView() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('All')
  const [starting, setStarting] = useState<string | null>(null)
  const counts = useMemo(() => new Map(EXAMPLES.map((e) => [e.id, parseCustomizer(e.code).length])), [])

  const q = query.trim().toLowerCase()
  const shown = EXAMPLES.filter(
    (e) => (tab === 'All' || e.category === tab) && (q === '' || e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))),
  )

  const start = async (e: GalleryExample) => {
    setStarting(e.id)
    try {
      await useProjectStore.getState().newProject({ name: e.name, code: e.code, origin: 'gallery', source: 'gallery', message: `Started from ${e.name}` })
      toWorkbench()
    } finally {
      setStarting(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-line bg-panel pr-3 pl-4">
        <span className="text-[15px] font-bold tracking-tight">ChatSCAD</span>
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        <span className="font-semibold">Examples</span>
        <span className="flex-1" />
        <button type="button" className="pc-btn is-sm" onClick={toWorkbench}>
          Back to project
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-4 py-6 md:px-12 md:py-8">
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex min-w-[min(320px,100%)] flex-1 flex-col gap-1.5">
            <h1 className="text-[20px] leading-[26px] font-semibold tracking-[-0.01em]">Start from a working model</h1>
            <p className="pc-muted">Every example is parametric and works offline. Starting from one copies it into a new project as version 1.</p>
          </div>
          <div className="pc-input w-full md:w-80">
            <IconSearch className="pc-i" aria-hidden="true" />
            <input placeholder="Search examples" aria-label="Search examples" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="pc-tabs self-start" role="tablist" aria-label="Categories">
          {(['All', ...CATEGORIES] as Tab[]).map((c) => (
            <button key={c} type="button" role="tab" className="pc-tab" aria-selected={tab === c} onClick={() => setTab(c)}>
              {c === 'All' ? `All ${EXAMPLES.length}` : c}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="pc-caption">No example matches “{query.trim()}”.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((e) => (
              <article key={e.id} className="pc-variant" aria-label={e.name} data-testid={`example-${e.id}`}>
                <span className="pc-variant-view">
                  <Glyph shapes={e.glyph} />
                </span>
                <span className="pc-variant-meta">
                  <span className="font-semibold">{e.name}</span>
                  <span className="pc-caption pc-mono">{counts.get(e.id)} params</span>
                </span>
                <span className="pc-row px-1">
                  {e.tags.map((t) => (
                    <span key={t} className="inline-flex h-5 items-center rounded-sm border border-line bg-inset px-1.5 text-[11px] font-medium text-ink-muted">
                      {t}
                    </span>
                  ))}
                </span>
                <button type="button" className="pc-btn is-sm" disabled={starting !== null} onClick={() => void start(e)}>
                  Start from this
                </button>
              </article>
            ))}
          </div>
        )}
        <p className="pc-caption">Want to add one? Examples are plain .scad files in the app's repository and can be added by pull request.</p>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/gallery/GalleryView.test.tsx && npm run typecheck`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/gallery/GalleryView.tsx src/gallery/GalleryView.test.tsx
git commit -m "feat(gallery): Examples page with search, categories and Start from this

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Passphrase lock for API keys

**Files:**
- Create: `src/security/lock.ts`, `src/settings/sections/SecuritySection.tsx`
- Modify (M2, described against the contracts): `src/ai/createProvider.ts`, `src/ai/errors.ts`, `src/db/profiles.ts`
- Test: `src/security/lock.test.ts`, `src/settings/sections/SecuritySection.test.tsx`

**Interfaces:**
- Consumes: `db`, `ProviderProfile`, `Settings` (Task 6); `getSettings`, `updateSettings` (Task 6); `useSettingsStore` (Task 6); `ProviderError` (M2 contract); `createProvider`, `describeProviderError` (M2 contract); icons (Task 14).
- Produces (`src/security/lock.ts`):
  - `PBKDF2_ITERATIONS = 310_000`; `LOCKED_MESSAGE = 'Your API keys are locked. Unlock them in Settings › Security.'`
  - `toBase64(bytes: Uint8Array): string`, `fromBase64(text: string): Uint8Array<ArrayBuffer>`.
  - `deriveKey(passphrase: string, salt: BufferSource, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey>` (PBKDF2, SHA-256 → AES-GCM 256, not extractable); `encryptString(key, plaintext): Promise<string>` (base64 of a random 12-byte IV followed by the ciphertext); `decryptString(key, b64): Promise<string>`.
  - `enableLock(passphrase: string): Promise<void>` (at least 8 characters; random 16-byte salt and an encrypted verifier go into settings with `lockMode: true`; every non-empty `apiKey` becomes ciphertext with `keyEncrypted: true`; the session stays unlocked).
  - `unlock(passphrase: string): Promise<boolean>`; `lock(): void`; `isUnlocked(): boolean`; `disableLock(): Promise<void>` (needs the unlocked keys; writes them back in plain text and clears the lock settings); `forgetLockedKeys(): Promise<void>` (clears encrypted keys and the lock settings, for a forgotten passphrase).
  - `unlockedKeyFor(profileId: string): string | null`; `resolveApiKey(profile: ProviderProfile): string` (throws `ProviderError('auth', LOCKED_MESSAGE)` for an encrypted key while locked); `sealProfile(profile: ProviderProfile): Promise<ProviderProfile>` (what M2's profile writer stores: encrypts a new plain key when lock mode is on, keeps unchanged ciphertext, refuses a new key while locked).
  - The derived `CryptoKey` and the decrypted keys live only in module-level variables, so closing the tab forgets them.
- `SecuritySection()`: lock off → passphrase twice, "Turn on lock"; locked → warn callout, passphrase, "Unlock", "Forget locked keys" with a confirmation; unlocked → ok callout "Keys are unlocked until you close this tab", "Lock now", "Turn off lock".

- [ ] **Step 1: Write the failing tests**

`src/security/lock.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { ProviderError } from '../ai/types'
import { db, type ProviderProfile } from '../db/db'
import { getSettings } from '../db/settings'
import { useSettingsStore } from '../settings/settingsStore'
import { resetDb } from '../test/resetDb'
import {
  decryptString, deriveKey, disableLock, enableLock, encryptString, forgetLockedKeys, fromBase64, isUnlocked, lock, LOCKED_MESSAGE,
  PBKDF2_ITERATIONS, resolveApiKey, sealProfile, unlock, unlockedKeyFor,
} from './lock'

const profile = (id: string, apiKey: string): ProviderProfile => ({
  id, name: id, adapter: 'openai-compatible', baseUrl: 'https://api.example.test/v1', apiKey, defaultModel: 'm', cachedModels: [],
  capabilities: { streaming: true, vision: false, audio: false }, priceTable: {}, createdAt: 1, updatedAt: 1,
})

const PASS = 'correct horse battery'

beforeEach(async () => {
  await resetDb()
  lock()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  await db.providerProfiles.bulkPut([profile('openai', 'sk-openai-123'), profile('ollama', '')])
})

it('encrypts and decrypts with AES-GCM, with a fresh IV each time', async () => {
  const key = await deriveKey(PASS, new Uint8Array(16), 1_000)
  const a = await encryptString(key, 'sk-1')
  const b = await encryptString(key, 'sk-1')
  expect(a).not.toBe(b)
  expect(await decryptString(key, a)).toBe('sk-1')
  const other = await deriveKey('wrong passphrase', new Uint8Array(16), 1_000)
  await expect(decryptString(other, a)).rejects.toThrow()
})

it('derives the key with PBKDF2, SHA-256, 310,000 iterations and a random 16-byte salt', async () => {
  const spy = vi.spyOn(crypto.subtle, 'deriveKey')
  await enableLock(PASS)
  expect(PBKDF2_ITERATIONS).toBe(310_000)
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310_000 }),
    expect.anything(),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const s = await getSettings()
  expect(fromBase64(s.lockSalt!)).toHaveLength(16)
  spy.mockRestore()
})

it('turns the lock on: keys become ciphertext, empty keys stay empty, settings record it', async () => {
  await enableLock(PASS)
  const stored = await db.providerProfiles.get('openai')
  expect(stored).toMatchObject({ keyEncrypted: true })
  expect(stored!.apiKey).not.toContain('sk-openai')
  expect(await db.providerProfiles.get('ollama')).toMatchObject({ apiKey: '', keyEncrypted: false })
  expect(useSettingsStore.getState().settings).toMatchObject({ lockMode: true, lockVerifier: expect.any(String) })
  expect(isUnlocked()).toBe(true)
  expect(resolveApiKey(stored!)).toBe('sk-openai-123')
  await expect(enableLock('short')).rejects.toThrow('Use a passphrase of at least 8 characters')
})

it('refuses provider calls while locked, never handing out the ciphertext', async () => {
  await enableLock(PASS)
  lock()
  const stored = (await db.providerProfiles.get('openai'))!
  expect(() => resolveApiKey(stored)).toThrow(ProviderError)
  try {
    resolveApiKey(stored)
  } catch (e) {
    expect(e).toMatchObject({ kind: 'auth', message: LOCKED_MESSAGE })
  }
  expect(resolveApiKey((await db.providerProfiles.get('ollama'))!)).toBe('')
})

it('unlocks only with the right passphrase', async () => {
  await enableLock(PASS)
  lock()
  expect(await unlock('wrong passphrase')).toBe(false)
  expect(isUnlocked()).toBe(false)
  expect(await unlock(PASS)).toBe(true)
  expect(unlockedKeyFor('openai')).toBe('sk-openai-123')
})

it('seals profiles the M2 form saves', async () => {
  expect(await sealProfile(profile('x', 'sk-plain'))).toMatchObject({ apiKey: 'sk-plain', keyEncrypted: false })

  await enableLock(PASS)
  const sealed = await sealProfile(profile('x', 'sk-new'))
  expect(sealed.keyEncrypted).toBe(true)
  expect(sealed.apiKey).not.toBe('sk-new')
  expect(await sealProfile(sealed)).toBe(sealed)
  expect(unlockedKeyFor('x')).toBe('sk-new')

  await db.providerProfiles.put(sealed)
  lock()
  expect(await sealProfile({ ...sealed, name: 'renamed' })).toMatchObject({ name: 'renamed', apiKey: sealed.apiKey })
  await expect(sealProfile({ ...sealed, apiKey: 'sk-changed' })).rejects.toThrow('Unlock your keys in Settings › Security before changing a key')
})

it('turns the lock off with the keys back in plain text', async () => {
  await enableLock(PASS)
  await disableLock()
  expect(await db.providerProfiles.get('openai')).toMatchObject({ apiKey: 'sk-openai-123', keyEncrypted: false })
  expect(await getSettings()).toMatchObject({ lockMode: false, lockSalt: null, lockVerifier: null })
  expect(isUnlocked()).toBe(false)
})

it('forgets locked keys when the passphrase is lost', async () => {
  await enableLock(PASS)
  lock()
  await expect(disableLock()).rejects.toThrow('Unlock the keys before turning the lock off')
  await forgetLockedKeys()
  expect(await db.providerProfiles.get('openai')).toMatchObject({ apiKey: '', keyEncrypted: false })
  expect(useSettingsStore.getState().settings.lockMode).toBe(false)
})
```

`src/settings/sections/SecuritySection.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../db/db'
import * as lockApi from '../../security/lock'
import { useSettingsStore } from '../settingsStore'
import { SecuritySection } from './SecuritySection'

vi.mock('../../security/lock', () => ({
  isUnlocked: vi.fn(() => false),
  enableLock: vi.fn(async () => {}),
  unlock: vi.fn(async (p: string) => p === 'right passphrase'),
  lock: vi.fn(),
  disableLock: vi.fn(async () => {}),
  forgetLockedKeys: vi.fn(async () => {}),
}))

const setLockMode = (lockMode: boolean) => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, lockMode } })

beforeEach(() => {
  vi.clearAllMocks()
  setLockMode(false)
})

it('turns the lock on only with two matching passphrases of 8 or more characters', async () => {
  render(<SecuritySection />)
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'short' } })
  fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: 'short' } })
  fireEvent.click(screen.getByRole('button', { name: 'Turn on lock' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Use a passphrase of at least 8 characters')

  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'long enough one' } })
  fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: 'long enough two' } })
  fireEvent.click(screen.getByRole('button', { name: 'Turn on lock' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("The passphrases don't match")

  fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: 'long enough one' } })
  fireEvent.click(screen.getByRole('button', { name: 'Turn on lock' }))
  await waitFor(() => expect(lockApi.enableLock).toHaveBeenCalledWith('long enough one'))
})

it('unlocks with the right passphrase and explains a wrong one', async () => {
  setLockMode(true)
  render(<SecuritySection />)
  expect(screen.getByText('Your API keys are locked')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'wrong one' } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("That passphrase didn't unlock the keys. Check it and try again.")
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'right passphrase' } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  expect(await screen.findByText('Keys are unlocked until you close this tab')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Lock now' }))
  expect(lockApi.lock).toHaveBeenCalled()
  expect(screen.getByText('Your API keys are locked')).toBeInTheDocument()
})

it('forgets locked keys only after confirming', async () => {
  setLockMode(true)
  render(<SecuritySection />)
  fireEvent.click(screen.getByRole('button', { name: 'Forget locked keys' }))
  expect(lockApi.forgetLockedKeys).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete the locked keys' }))
  await waitFor(() => expect(lockApi.forgetLockedKeys).toHaveBeenCalled())
})

it('turns the lock off when unlocked', async () => {
  setLockMode(true)
  vi.mocked(lockApi.isUnlocked).mockReturnValue(true)
  render(<SecuritySection />)
  fireEvent.click(screen.getByRole('button', { name: 'Turn off lock' }))
  await waitFor(() => expect(lockApi.disableLock).toHaveBeenCalled())
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/security src/settings/sections/SecuritySection.test.tsx`
Expected: FAIL with "Failed to resolve import './lock'" and "… './SecuritySection'".

- [ ] **Step 3: Write minimal implementation**

`src/security/lock.ts`:

```ts
import { ProviderError } from '../ai/types'
import { db, type ProviderProfile } from '../db/db'
import { getSettings, updateSettings } from '../db/settings'
import { useSettingsStore } from '../settings/settingsStore'

export const PBKDF2_ITERATIONS = 310_000
export const LOCKED_MESSAGE = 'Your API keys are locked. Unlock them in Settings › Security.'
const VERIFIER = 'chatscad-lock-v1'

// Held in memory only: closing the tab forgets them (spec "Security").
let unlockedKey: CryptoKey | null = null
let plainKeys = new Map<string, string>()

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function deriveKey(passphrase: string, salt: BufferSource, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptString(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toBase64(out)
}

export async function decryptString(key: CryptoKey, b64: string): Promise<string> {
  const bytes = fromBase64(b64)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
  return new TextDecoder().decode(plain)
}

export const isUnlocked = (): boolean => unlockedKey !== null

export function lock(): void {
  unlockedKey = null
  plainKeys = new Map()
}

export const unlockedKeyFor = (profileId: string): string | null => plainKeys.get(profileId) ?? null

async function writeProfilesAndSettings(profiles: ProviderProfile[], patch: Parameters<typeof updateSettings>[0]): Promise<void> {
  await db.transaction('rw', db.providerProfiles, db.settings, async () => {
    await db.providerProfiles.bulkPut(profiles)
    await updateSettings(patch)
  })
  await useSettingsStore.getState().load()
}

export async function enableLock(passphrase: string): Promise<void> {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt)
  const plain = new Map<string, string>()
  const sealed: ProviderProfile[] = []
  for (const p of await db.providerProfiles.toArray()) {
    if (p.apiKey === '') {
      sealed.push({ ...p, keyEncrypted: false })
      continue
    }
    plain.set(p.id, p.apiKey)
    sealed.push({ ...p, apiKey: await encryptString(key, p.apiKey), keyEncrypted: true })
  }
  await writeProfilesAndSettings(sealed, { lockMode: true, lockSalt: toBase64(salt), lockVerifier: await encryptString(key, VERIFIER) })
  unlockedKey = key
  plainKeys = plain
}

export async function unlock(passphrase: string): Promise<boolean> {
  const s = await getSettings()
  if (!s.lockMode || !s.lockSalt || !s.lockVerifier) return true
  const key = await deriveKey(passphrase, fromBase64(s.lockSalt))
  try {
    if ((await decryptString(key, s.lockVerifier)) !== VERIFIER) return false
  } catch {
    return false
  }
  const plain = new Map<string, string>()
  for (const p of await db.providerProfiles.toArray()) {
    if (!p.keyEncrypted || p.apiKey === '') continue
    try {
      plain.set(p.id, await decryptString(key, p.apiKey))
    } catch {
      // A damaged key stays locked; the provider call then reports it.
    }
  }
  unlockedKey = key
  plainKeys = plain
  return true
}

export async function disableLock(): Promise<void> {
  if (!unlockedKey) throw new Error('Unlock the keys before turning the lock off')
  const opened = (await db.providerProfiles.toArray()).map((p) =>
    p.keyEncrypted ? { ...p, apiKey: plainKeys.get(p.id) ?? '', keyEncrypted: false } : p,
  )
  await writeProfilesAndSettings(opened, { lockMode: false, lockSalt: null, lockVerifier: null })
  lock()
}

export async function forgetLockedKeys(): Promise<void> {
  const cleared = (await db.providerProfiles.toArray()).map((p) => (p.keyEncrypted ? { ...p, apiKey: '', keyEncrypted: false } : p))
  await writeProfilesAndSettings(cleared, { lockMode: false, lockSalt: null, lockVerifier: null })
  lock()
}

/** The key createProvider() may use. Never returns ciphertext. */
export function resolveApiKey(profile: ProviderProfile): string {
  if (!profile.keyEncrypted) return profile.apiKey
  const key = plainKeys.get(profile.id)
  if (key === undefined) throw new ProviderError('auth', LOCKED_MESSAGE)
  return key
}

/** What M2's profile writer stores. */
export async function sealProfile(profile: ProviderProfile): Promise<ProviderProfile> {
  const { lockMode } = await getSettings()
  if (!lockMode) return profile.keyEncrypted ? profile : { ...profile, keyEncrypted: false }
  if (profile.apiKey === '') {
    plainKeys.delete(profile.id)
    return { ...profile, keyEncrypted: false }
  }
  if (!unlockedKey) {
    const stored = await db.providerProfiles.get(profile.id)
    if (profile.keyEncrypted && stored?.apiKey === profile.apiKey) return profile
    throw new Error('Unlock your keys in Settings › Security before changing a key')
  }
  if (profile.keyEncrypted) {
    try {
      plainKeys.set(profile.id, await decryptString(unlockedKey, profile.apiKey))
      return profile
    } catch {
      // The form put a new plain key where the ciphertext was.
    }
  }
  plainKeys.set(profile.id, profile.apiKey)
  return { ...profile, apiKey: await encryptString(unlockedKey, profile.apiKey), keyEncrypted: true }
}
```

`src/settings/sections/SecuritySection.tsx`:

```tsx
import { useState } from 'react'
import { disableLock, enableLock, forgetLockedKeys, isUnlocked, lock, unlock } from '../../security/lock'
import { IconLock, IconUnlock } from '../../ui/icons'
import { useSettingsStore } from '../settingsStore'

export function SecuritySection() {
  const lockMode = useSettingsStore((s) => s.settings.lockMode)
  const [unlocked, setUnlocked] = useState(isUnlocked())
  const [pass, setPass] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const turnOn = () =>
    run(async () => {
      if (pass.length < 8) throw new Error('Use a passphrase of at least 8 characters')
      if (pass !== repeat) throw new Error("The passphrases don't match")
      await enableLock(pass)
      setPass('')
      setRepeat('')
      setUnlocked(true)
    })

  const tryUnlock = () =>
    run(async () => {
      if (!(await unlock(pass))) throw new Error("That passphrase didn't unlock the keys. Check it and try again.")
      setPass('')
      setUnlocked(true)
    })

  const passField = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div className="pc-field">
      <label htmlFor={id}>{label}</label>
      <div className="pc-input">
        <input id={id} type="password" autoComplete={autoComplete} value={value} onChange={(e) => set(e.target.value)} />
      </div>
    </div>
  )

  return (
    <section aria-labelledby="security-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="security-title" className="text-[20px] leading-[26px] font-semibold">
        Security
      </h2>
      <p className="pc-muted">
        API keys stay in this browser and are never included in exports or share links. With the lock on, they are encrypted with your
        passphrase (PBKDF2 with 310,000 rounds, then AES-GCM) and decrypted only in memory until you close the tab.
      </p>

      {!lockMode && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void turnOn()
          }}
        >
          {passField('lock-pass', 'Passphrase', pass, setPass, 'new-password')}
          {passField('lock-repeat', 'Repeat passphrase', repeat, setRepeat, 'new-password')}
          <span className="pc-hint">At least 8 characters. If you forget it, the keys can't be recovered; you would enter them again.</span>
          <div className="pc-row">
            <button type="submit" className="pc-btn is-primary" disabled={busy}>
              Turn on lock
            </button>
          </div>
        </form>
      )}

      {lockMode && !unlocked && (
        <>
          <div className="pc-callout is-warn">
            <IconLock className="pc-i" aria-hidden="true" />
            <div className="pc-callout-body">
              <strong>Your API keys are locked</strong>
              Unlock them to use AI or to change a key.
            </div>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void tryUnlock()
            }}
          >
            {passField('unlock-pass', 'Passphrase', pass, setPass, 'current-password')}
            <div className="pc-row">
              <button type="submit" className="pc-btn is-primary" disabled={busy}>
                Unlock
              </button>
              {confirmForget ? (
                <>
                  <span className="pc-caption">This deletes the encrypted keys; you will enter them again.</span>
                  <button type="button" className="pc-btn is-danger" onClick={() => void run(forgetLockedKeys)}>
                    Delete the locked keys
                  </button>
                </>
              ) : (
                <button type="button" className="pc-btn is-ghost" onClick={() => setConfirmForget(true)}>
                  Forget locked keys
                </button>
              )}
            </div>
          </form>
        </>
      )}

      {lockMode && unlocked && (
        <>
          <div className="pc-callout is-ok">
            <IconUnlock className="pc-i" aria-hidden="true" />
            <div className="pc-callout-body">
              <strong>Keys are unlocked until you close this tab</strong>
              They are stored encrypted.
            </div>
          </div>
          <div className="pc-row">
            <button
              type="button"
              className="pc-btn"
              onClick={() => {
                lock()
                setUnlocked(false)
              }}
            >
              Lock now
            </button>
            <button type="button" className="pc-btn is-ghost" disabled={busy} onClick={() => void run(async () => (await disableLock(), setUnlocked(false)))}>
              Turn off lock
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="pc-hint is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
```

M2 changes (keep everything else in those files):

1. `src/ai/createProvider.ts`: resolve the key through the lock before building an adapter. M2's switch on `profile.adapter` stays; it receives `resolved` instead of `profile`:

```ts
import { resolveApiKey } from '../security/lock'

export function createProvider(profile: ProviderProfile): LlmProvider {
  // Throws ProviderError('auth', LOCKED_MESSAGE) while the keys are locked; never passes ciphertext on.
  const resolved: ProviderProfile = { ...profile, apiKey: resolveApiKey(profile), keyEncrypted: false }
  // M2's existing body follows, using `resolved` where it used `profile`.
}
```

2. `src/ai/errors.ts`: make `describeProviderError` explain the lock before its generic `auth` text (first lines of the function):

```ts
import { LOCKED_MESSAGE } from '../security/lock'

  if (err instanceof ProviderError && err.message === LOCKED_MESSAGE) {
    return { title: 'Your API keys are locked', body: 'Unlock them in Settings › Security, then send again.' }
  }
```

   and add to M2's `src/ai/errors.test.ts`:

```ts
it('explains locked keys instead of blaming the provider', () => {
  expect(describeProviderError(new ProviderError('auth', LOCKED_MESSAGE), 'https://api.openai.com/v1')).toEqual({
    title: 'Your API keys are locked',
    body: 'Unlock them in Settings › Security, then send again.',
  })
})
```

3. `src/db/profiles.ts`: the function that writes a profile (M2's plan defines it as `saveProfile(profile: ProviderProfile): Promise<ProviderProfile>`; see "Contract issues") stores `await sealProfile(p)` instead of `p`:

```ts
import { sealProfile } from '../security/lock'

export async function saveProfile(profile: ProviderProfile): Promise<ProviderProfile> {
  const saved = { ...profile, updatedAt: Date.now() }
  await db.providerProfiles.put(await sealProfile(saved))
  // Callers keep working with the plaintext key in memory; only the stored copy is sealed.
  return saved
}
```

   M2's provider form must show the error text when this throws ("Unlock your keys in Settings › Security before changing a key"); if it does not already catch save errors, wrap its save call in `try/catch` and show the message in its existing `pc-callout is-error`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/security src/settings/sections/SecuritySection.test.tsx src/ai && npm run typecheck`
Expected: PASS (8 + 4 new tests, the new errors test and M2's AI tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/security src/settings/sections/SecuritySection.tsx src/settings/sections/SecuritySection.test.tsx src/ai/createProvider.ts src/ai/errors.ts src/ai/errors.test.ts src/db/profiles.ts
git commit -m "feat(security): optional passphrase lock for API keys (PBKDF2 to AES-GCM, keys in memory only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Settings sections: Usage and cost, Rendering, Libraries, Appearance, Storage and backup

**Files:**
- Create: `src/settings/theme.ts`, `src/db/usageTotals.ts`, `src/settings/format.ts`, `src/settings/sections/RenderingSection.tsx`, `src/settings/sections/AppearanceSection.tsx`, `src/settings/sections/LibrariesSection.tsx`, `src/settings/sections/UsageSection.tsx`, `src/settings/sections/StorageSection.tsx`, `src/settings/sections.tsx`
- Modify (M2, described against the design doc): the settings page that renders the "Settings sections" nav (screen Providers)
- Test: `src/settings/theme.test.ts`, `src/db/usageTotals.test.ts`, `src/settings/sections/sections.test.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` (Task 6); `ThemeSetting`, `UsageRecord`, `db` (Task 6); `useProjectStore` (`project`, `setEnabledLibraries`, Task 9); `LIBRARY_NAMES`, `LIBRARY_INFO` (Task 4); `saveBackupFile` (Task 16); `SecuritySection` (Task 21); `listProfiles` from M2's `src/db/profiles.ts` (assumed name, see "Contract issues"); `formatCost`, `formatTokens` (M2).
- Produces:
  - `src/settings/theme.ts`: `applyTheme(theme: ThemeSetting, root?: HTMLElement | null): void` (`system` removes `data-theme`, so `tokens.css` follows the OS; `dark`/`light` set it; no-op without a document).
  - `src/db/usageTotals.ts`: `interface UsageTotal { tokens: number; cost: number; unpriced: number }`; `startOfDay(now: number): number`, `startOfMonth(now: number): number` (local time); `usageTotalsSince(since: number): Promise<Map<string, UsageTotal>>` (keyed by profile id; `unpriced` counts rows with a null cost).
  - `src/settings/format.ts`: `formatBytes(n: number): string` ("512 KB", "12.4 MB", "2.1 GB").
  - Sections (each a `<section>` with an `h2` and the design voice): `RenderingSection` (Debounce in ms 100–5,000, Timeout in s 5–600, Auto-fix attempts 0–5; invalid input shows the allowed range and is not saved), `AppearanceSection` (System / Dark / Light radio group), `LibrariesSection` (a `pc-switch` per library for the open project, with version, licence and usage line), `UsageSection` (per profile: today and this month, "$0.12 · 41,200 tok", and a note when some calls had no price), `StorageSection` (usage estimate, persistent or not, "Ask to keep data" calling `navigator.storage.persist()`, "Export all projects (.json)").
  - `src/settings/sections.tsx`: `type SettingsSectionId = 'providers' | 'usage' | 'rendering' | 'libraries' | 'appearance' | 'storage' | 'security'`; `interface SettingsSection { id: SettingsSectionId; label: string; Component: React.ComponentType | null }`; `SETTINGS_SECTIONS` in the screen's order (`providers` has `Component: null`: M2 renders it).
  - Theme changes are applied by `startApp` (Task 23), which subscribes to `settings.theme`.

- [ ] **Step 1: Write the failing tests**

`src/settings/theme.test.ts`:

```ts
import { formatBytes } from './format'
import { applyTheme } from './theme'

it('sets data-theme for dark and light and removes it for system', () => {
  const root = document.createElement('html')
  applyTheme('light', root)
  expect(root.dataset.theme).toBe('light')
  applyTheme('dark', root)
  expect(root.dataset.theme).toBe('dark')
  applyTheme('system', root)
  expect(root.hasAttribute('data-theme')).toBe(false)
  expect(() => applyTheme('dark', null)).not.toThrow()
})

it('formats byte counts with units', () => {
  expect(formatBytes(512 * 1024)).toBe('512 KB')
  expect(formatBytes(12.4 * 1024 * 1024)).toBe('12.4 MB')
  expect(formatBytes(2.1 * 1024 ** 3)).toBe('2.1 GB')
  expect(formatBytes(0)).toBe('0 KB')
})
```

`src/db/usageTotals.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { resetDb } from '../test/resetDb'
import { db, type UsageRecord } from './db'
import { startOfDay, startOfMonth, usageTotalsSince } from './usageTotals'

const row = (profileId: string, createdAt: number, cost: number | null, tokens = 100): UsageRecord => ({
  id: crypto.randomUUID(), profileId, model: 'm', inputTokens: tokens, outputTokens: 0, cost,
  costSource: cost === null ? null : 'provider', createdAt, projectId: null, versionId: null,
})

beforeEach(resetDb)

it('adds up tokens and known costs per profile since a time, counting unpriced calls', async () => {
  await db.usage.bulkAdd([row('a', 10, 0.01), row('a', 20, null, 50), row('b', 30, 0.5), row('a', 5, 9)])
  const totals = await usageTotalsSince(10)
  expect(totals.get('a')).toEqual({ tokens: 150, cost: 0.01, unpriced: 1 })
  expect(totals.get('b')).toEqual({ tokens: 100, cost: 0.5, unpriced: 0 })
})

it('finds the start of the local day and month', () => {
  const t = new Date(2026, 9, 11, 15, 30).getTime()
  expect(startOfDay(t)).toBe(new Date(2026, 9, 11).getTime())
  expect(startOfMonth(t)).toBe(new Date(2026, 9, 1).getTime())
})
```

`src/settings/sections/sections.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../db/db'
import { saveBackupFile } from '../../history/projectFile'
import { useProjectStore } from '../../history/projectStore'
import { makeProject } from '../../test/fixtures'
import { SETTINGS_SECTIONS } from '../sections'
import { useSettingsStore } from '../settingsStore'
import { AppearanceSection } from './AppearanceSection'
import { LibrariesSection } from './LibrariesSection'
import { RenderingSection } from './RenderingSection'
import { StorageSection } from './StorageSection'
import { UsageSection } from './UsageSection'

vi.mock('../../history/projectFile', () => ({ saveBackupFile: vi.fn(async () => {}) }))
vi.mock('../../db/profiles', () => ({
  listProfiles: async () => [
    { id: 'a', name: 'Anthropic' },
    { id: 'o', name: 'Ollama' },
  ],
}))
vi.mock('../../db/usageTotals', async (orig) => ({
  ...(await orig<typeof import('../../db/usageTotals')>()),
  usageTotalsSince: async (since: number) =>
    since > new Date(2000, 0, 2).getTime() && since === new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      ? new Map([['a', { tokens: 41_200, cost: 0.12, unpriced: 0 }]])
      : new Map([
          ['a', { tokens: 412_000, cost: 1.84, unpriced: 0 }],
          ['o', { tokens: 58_000, cost: 0, unpriced: 3 }],
        ]),
}))

const update = vi.fn(async () => {})

beforeEach(() => {
  update.mockClear()
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, update })
})
afterEach(() => vi.unstubAllGlobals())

it('lists the settings sections in the order of the Providers screen', () => {
  expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
    'AI providers', 'Usage and cost', 'Rendering', 'Libraries', 'Appearance', 'Storage and backup', 'Security',
  ])
  expect(SETTINGS_SECTIONS[0]!.Component).toBeNull()
  expect(SETTINGS_SECTIONS.slice(1).every((s) => s.Component !== null)).toBe(true)
})

it('saves rendering settings in their units and rejects values out of range', () => {
  render(<RenderingSection />)
  fireEvent.change(screen.getByLabelText('Debounce'), { target: { value: '900' } })
  fireEvent.blur(screen.getByLabelText('Debounce'))
  expect(update).toHaveBeenCalledWith({ debounceMs: 900 })
  fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: '30' } })
  fireEvent.blur(screen.getByLabelText('Timeout'))
  expect(update).toHaveBeenCalledWith({ timeoutMs: 30_000 })
  fireEvent.change(screen.getByLabelText('Auto-fix attempts'), { target: { value: '9' } })
  fireEvent.blur(screen.getByLabelText('Auto-fix attempts'))
  expect(screen.getByText('Enter a whole number from 0 to 5')).toBeInTheDocument()
  expect(update).toHaveBeenCalledTimes(2)
})

it('switches the theme', () => {
  render(<AppearanceSection />)
  expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
  expect(update).toHaveBeenCalledWith({ theme: 'light' })
})

it('enables libraries for the open project', () => {
  const setEnabledLibraries = vi.fn(async () => {})
  useProjectStore.setState({ project: makeProject({ enabledLibraries: ['MCAD'] }), setEnabledLibraries })
  render(<LibrariesSection />)
  expect(screen.getByRole('checkbox', { name: 'MCAD' })).toBeChecked()
  expect(screen.getByText('BOSL2 v2.0.766 · BSD-2-Clause · include <BOSL2/std.scad>')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'BOSL2' }))
  expect(setEnabledLibraries).toHaveBeenCalledWith(['BOSL2', 'MCAD'])
  useProjectStore.setState({ project: null })
})

it('shows usage per profile for today and this month', async () => {
  render(<UsageSection />)
  expect(await screen.findByTestId('usage-a')).toHaveTextContent('Anthropic$0.120 · 41,200 tok$1.84 · 412,000 tok')
  expect(screen.getByTestId('usage-o')).toHaveTextContent('Ollama$0.000 · 0 tok$0.000 · 58,000 tok')
  expect(screen.getByText(/3 calls this month had no price/)).toBeInTheDocument()
})

it('shows storage use and persistence, asks to keep data, and exports everything', async () => {
  const persist = vi.fn(async () => true)
  let persisted = false
  vi.stubGlobal('navigator', {
    storage: {
      estimate: async () => ({ usage: 12.4 * 1024 * 1024, quota: 2.1 * 1024 ** 3 }),
      persisted: async () => persisted,
      persist: async () => ((persisted = await persist()), persisted),
    },
  })
  render(<StorageSection />)
  expect(await screen.findByText('Using 12.4 MB of 2.1 GB')).toBeInTheDocument()
  expect(screen.getByText(/The browser may clear projects when space runs low/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ask to keep data' }))
  await waitFor(() => expect(screen.getByText(/won't clear your projects/)).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Export all projects (.json)' }))
  expect(saveBackupFile).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/settings src/db/usageTotals.test.ts`
Expected: FAIL with "Failed to resolve import './theme'", "… './usageTotals'", "… '../sections'".

- [ ] **Step 3: Write minimal implementation**

`src/settings/theme.ts`:

```ts
import type { ThemeSetting } from '../db/db'

/** tokens.css: dark is :root, light via [data-theme="light"] or the OS; [data-theme="dark"] forces dark. */
export function applyTheme(theme: ThemeSetting, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = theme
}
```

`src/settings/format.ts`:

```ts
export function formatBytes(n: number): string {
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${Number(gb.toFixed(1))} GB`
  const mb = n / 1024 ** 2
  if (mb >= 1) return `${Number(mb.toFixed(1))} MB`
  return `${Math.round(n / 1024)} KB`
}
```

`src/db/usageTotals.ts`:

```ts
import { db } from './db'

export interface UsageTotal {
  tokens: number
  cost: number
  unpriced: number
}

export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function startOfMonth(now: number): number {
  const d = new Date(startOfDay(now))
  d.setDate(1)
  return d.getTime()
}

export async function usageTotalsSince(since: number): Promise<Map<string, UsageTotal>> {
  const totals = new Map<string, UsageTotal>()
  for (const u of await db.usage.where('createdAt').aboveOrEqual(since).toArray()) {
    const t = totals.get(u.profileId) ?? { tokens: 0, cost: 0, unpriced: 0 }
    t.tokens += u.inputTokens + u.outputTokens
    if (u.cost === null) t.unpriced++
    else t.cost += u.cost
    totals.set(u.profileId, t)
  }
  return totals
}
```

`src/settings/sections/RenderingSection.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Settings } from '../../db/db'
import { useSettingsStore } from '../settingsStore'

interface FieldSpec {
  id: string
  label: string
  unit: string
  min: number
  max: number
  read(s: Settings): number
  write(n: number): Partial<Omit<Settings, 'id'>>
  hint: string
}

const FIELDS: FieldSpec[] = [
  { id: 'debounce', label: 'Debounce', unit: 'ms', min: 100, max: 5_000, read: (s) => s.debounceMs, write: (n) => ({ debounceMs: n }), hint: 'How long to wait after the last change before rendering.' },
  { id: 'timeout', label: 'Timeout', unit: 's', min: 5, max: 600, read: (s) => s.timeoutMs / 1000, write: (n) => ({ timeoutMs: n * 1000 }), hint: 'A render that takes longer is stopped and the worker restarted.' },
  { id: 'autofix', label: 'Auto-fix attempts', unit: '', min: 0, max: 5, read: (s) => s.autoFixAttempts, write: (n) => ({ autoFixAttempts: n }), hint: 'How often a failed AI result is sent back with the errors.' },
]

function Field({ spec, settings }: { spec: FieldSpec; settings: Settings }) {
  const value = spec.read(settings)
  const [draft, setDraft] = useState(String(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    const ok = draft.trim() !== '' && Number.isInteger(n) && n >= spec.min && n <= spec.max
    setInvalid(!ok)
    if (ok && n !== value) void useSettingsStore.getState().update(spec.write(n))
  }
  return (
    <div className="pc-field">
      <label htmlFor={spec.id}>{spec.label}</label>
      <div className={`pc-input is-mono w-40${invalid ? ' is-invalid' : ''}`}>
        <input id={spec.id} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
        {spec.unit && <span className="pc-unit">{spec.unit}</span>}
      </div>
      <span className={`pc-hint${invalid ? ' is-error' : ''}`}>
        {invalid ? `Enter a whole number from ${spec.min.toLocaleString('en-US')} to ${spec.max.toLocaleString('en-US')}` : spec.hint}
      </span>
    </div>
  )
}

export function RenderingSection() {
  const settings = useSettingsStore((s) => s.settings)
  return (
    <section aria-labelledby="rendering-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="rendering-title" className="text-[20px] leading-[26px] font-semibold">
        Rendering
      </h2>
      {FIELDS.map((f) => (
        <Field key={f.id} spec={f} settings={settings} />
      ))}
    </section>
  )
}
```

`src/settings/sections/AppearanceSection.tsx`:

```tsx
import type { ThemeSetting } from '../../db/db'
import { useSettingsStore } from '../settingsStore'

const OPTIONS: Array<{ value: ThemeSetting; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

export function AppearanceSection() {
  const theme = useSettingsStore((s) => s.settings.theme)
  return (
    <section aria-labelledby="appearance-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="appearance-title" className="text-[20px] leading-[26px] font-semibold">
        Appearance
      </h2>
      <div role="radiogroup" aria-label="Theme" className="pc-tabs self-start">
        {OPTIONS.map((o) => (
          <label key={o.value} className="pc-tab has-[:checked]:bg-accent-soft has-[:checked]:text-ink">
            <input
              type="radio"
              name="theme"
              className="sr-only"
              checked={theme === o.value}
              onChange={() => void useSettingsStore.getState().update({ theme: o.value })}
            />
            {o.label}
          </label>
        ))}
      </div>
      <span className="pc-hint">System follows your device. Dark is the primary theme; light is a full peer.</span>
    </section>
  )
}
```

`src/settings/sections/LibrariesSection.tsx`:

```tsx
import { useProjectStore } from '../../history/projectStore'
import { LIBRARY_INFO, LIBRARY_NAMES } from '../../render/libraries'

export function LibrariesSection() {
  const project = useProjectStore((s) => s.project)
  return (
    <section aria-labelledby="libraries-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="libraries-title" className="text-[20px] leading-[26px] font-semibold">
        Libraries
      </h2>
      <p className="pc-muted">
        Enabled libraries are written into every render of this project and offered to the AI. They are bundled with the app and work offline.
      </p>
      {!project ? (
        <p className="pc-caption">Open a project to choose its libraries.</p>
      ) : (
        <div className="pc-stack">
          <span className="pc-label">For {project.name}</span>
          {LIBRARY_NAMES.map((name) => {
            const on = project.enabledLibraries.includes(name)
            const info = LIBRARY_INFO[name]
            return (
              <div key={name} className="flex flex-col gap-1">
                <label className="pc-switch">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = LIBRARY_NAMES.filter((n) => (n === name ? !on : project.enabledLibraries.includes(n)))
                      void useProjectStore.getState().setEnabledLibraries(next)
                    }}
                  />
                  <span className="pc-track" />
                  {name}
                </label>
                <span className="pc-caption pc-mono">
                  {name} {info.version} · {info.license} · {info.usage}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
```

`src/settings/sections/UsageSection.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { ProviderProfile } from '../../db/db'
import { listProfiles } from '../../db/profiles'
import { startOfDay, startOfMonth, usageTotalsSince, type UsageTotal } from '../../db/usageTotals'
import { formatCost, formatTokens } from '../../ui/format'

const EMPTY: UsageTotal = { tokens: 0, cost: 0, unpriced: 0 }
const cell = (t: UsageTotal | undefined) => `${formatCost((t ?? EMPTY).cost)} · ${formatTokens((t ?? EMPTY).tokens)}`

export function UsageSection() {
  const [rows, setRows] = useState<{ profiles: ProviderProfile[]; today: Map<string, UsageTotal>; month: Map<string, UsageTotal> } | null>(null)

  useEffect(() => {
    let live = true
    const now = Date.now()
    void Promise.all([listProfiles(), usageTotalsSince(startOfDay(now)), usageTotalsSince(startOfMonth(now))]).then(([profiles, today, month]) => {
      if (live) setRows({ profiles, today, month })
    })
    return () => {
      live = false
    }
  }, [])

  const unpriced = rows ? [...rows.month.values()].reduce((n, t) => n + t.unpriced, 0) : 0
  const ids = rows ? [...new Set([...rows.profiles.map((p) => p.id), ...rows.month.keys()])] : []

  return (
    <section aria-labelledby="usage-title" className="flex max-w-[720px] flex-col gap-5 p-6">
      <h2 id="usage-title" className="text-[20px] leading-[26px] font-semibold">
        Usage and cost
      </h2>
      {!rows ? (
        <p className="pc-caption">Loading usage…</p>
      ) : ids.length === 0 ? (
        <p className="pc-caption">No AI calls yet.</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 gap-y-2">
          <span className="pc-label">Profile</span>
          <span className="pc-label">Today</span>
          <span className="pc-label">This month</span>
          {ids.map((id) => (
            <div key={id} className="contents" data-testid={`usage-${id}`}>
              <span>{rows.profiles.find((p) => p.id === id)?.name ?? 'Deleted profile'}</span>
              <span className="pc-mono">{cell(rows.today.get(id))}</span>
              <span className="pc-mono">{cell(rows.month.get(id))}</span>
            </div>
          ))}
        </div>
      )}
      {unpriced > 0 && (
        <p className="pc-hint">
          {unpriced} calls this month had no price and count as $0.000. Set prices in the profile's price table under AI providers.
        </p>
      )}
    </section>
  )
}
```

`src/settings/sections/StorageSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { saveBackupFile } from '../../history/projectFile'
import { formatBytes } from '../format'

export function StorageSection() {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    const storage = navigator.storage
    if (!storage) return
    const e = await storage.estimate?.()
    if (e) setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 })
    setPersisted((await storage.persisted?.()) ?? null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <section aria-labelledby="storage-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="storage-title" className="text-[20px] leading-[26px] font-semibold">
        Storage and backup
      </h2>
      <p className="pc-muted">Projects, versions and chats live only in this browser. There is no sync, so export a backup now and then.</p>
      {estimate && <span className="pc-mono">Using {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)}</span>}
      {persisted === true && <p className="pc-caption">Storage is persistent: the browser won't clear your projects to free space.</p>}
      {persisted === false && (
        <div className="pc-row">
          <p className="pc-caption">The browser may clear projects when space runs low.</p>
          <button
            type="button"
            className="pc-btn is-sm"
            onClick={() => void navigator.storage.persist().then(refresh)}
          >
            Ask to keep data
          </button>
        </div>
      )}
      <div className="pc-row">
        <button type="button" className="pc-btn is-primary" onClick={() => void saveBackupFile()}>
          Export all projects (.json)
        </button>
      </div>
      <span className="pc-hint">Backups contain code, versions, chats and presets. API keys are never included.</span>
    </section>
  )
}
```

`src/settings/sections.tsx`:

```tsx
import type { ComponentType } from 'react'
import { AppearanceSection } from './sections/AppearanceSection'
import { LibrariesSection } from './sections/LibrariesSection'
import { RenderingSection } from './sections/RenderingSection'
import { SecuritySection } from './sections/SecuritySection'
import { StorageSection } from './sections/StorageSection'
import { UsageSection } from './sections/UsageSection'

export type SettingsSectionId = 'providers' | 'usage' | 'rendering' | 'libraries' | 'appearance' | 'storage' | 'security'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  /** null: rendered by M2's AI providers page. */
  Component: ComponentType | null
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'providers', label: 'AI providers', Component: null },
  { id: 'usage', label: 'Usage and cost', Component: UsageSection },
  { id: 'rendering', label: 'Rendering', Component: RenderingSection },
  { id: 'libraries', label: 'Libraries', Component: LibrariesSection },
  { id: 'appearance', label: 'Appearance', Component: AppearanceSection },
  { id: 'storage', label: 'Storage and backup', Component: StorageSection },
  { id: 'security', label: 'Security', Component: SecuritySection },
]
```

M2 change: in M2's settings page (the one with `<nav aria-label="Settings sections">`), keep a `section` state of type `SettingsSectionId` (default `'providers'`), render the nav from `SETTINGS_SECTIONS` with M2's existing button classes (the selected one gets M2's selected style and `aria-current="page"`), and render the body as:

```tsx
{section === 'providers' ? (
  /* M2's existing profiles list and profile form, unchanged */
  providersPage
) : (
  (() => {
    const { Component } = SETTINGS_SECTIONS.find((s) => s.id === section)!
    return Component ? <Component /> : null
  })()
)}
```

where `providersPage` is the JSX M2 already renders for AI providers (move it into that variable). The M2 nav entries that pointed at M3 sections are replaced by this list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/settings src/db/usageTotals.test.ts && npm run typecheck`
Expected: PASS (2 + 2 + 6 new tests and Tasks 6 and 21's settings tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/settings src/db/usageTotals.ts src/db/usageTotals.test.ts
git commit -m "feat(settings): Usage and cost, Rendering, Libraries, Appearance and Storage and backup sections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: App wiring and startup

**Files:**
- Create: `src/app/startApp.ts`
- Modify: `src/main.tsx`, `src/App.tsx` (M1 file as changed by M2; changes described against M1's elements, which M2 keeps)
- Test: `src/app/startApp.test.ts`, `src/App.test.tsx`

**Interfaces:**
- Consumes: everything above: `useSettingsStore` (Task 6), `applyTheme` (Task 22), `installUsageHook` (Task 12), `startChatPersistence` (Task 12), `startRecorder` (Task 11), `onBeforeLeaveHead`, `useProjectStore` (Task 9), `getProject`, `listRecentProjects` (Task 6), `captureThumbnail` (Task 10), `CustomizerDock` (Task 14), `CodePane` (Task 15), `HistoryView` (Task 17), `ProjectMenu`, `HistoryControls`, `RenderedFromCaption`, `useUndoShortcuts` (Task 18), `useRenderedVersionLabel` (Task 18), `GalleryView` (Task 20), `ComposerBridge` (Task 12).
- Produces:
  - `src/app/startApp.ts`: `interface StartedApp { stop(): void }`; `startApp(deps?: { capture?(): Promise<Blob | null> }): Promise<StartedApp>`: loads settings, applies and follows the theme, installs the usage hook, starts chat persistence and the recorder (AI and auto-fix versions link their chat turn), registers `recorder.flush` as the before-leave hook, reloads the chat whenever the open project changes, then opens the last project, else the most recent one, else a new blank project from the code already in the editor (so nothing typed before startup is lost). Called once from `main.tsx`.
  - `App`: the render loop uses `settings.debounceMs` / `settings.timeoutMs`; views `gallery` (full page) and `history` (shared header, History view instead of the workbench); header gains `ProjectMenu`, `RenderedFromCaption`, `HistoryControls`; the 3D view gains the Customizer dock and passes `thumbnails` and `staleLabel` to the viewer; the code section becomes `CodePane`; `ComposerBridge` and `useUndoShortcuts` are mounted.

- [ ] **Step 1: Write the failing tests**

`src/app/startApp.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto'
import { useChatStore } from '../chat/chatStore'
import { db } from '../db/db'
import { useProjectStore } from '../history/projectStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { startApp, type StartedApp } from './startApp'

let app: StartedApp | null = null

const resetStores = () => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useChatStore.setState({ messages: [] })
}

beforeEach(async () => {
  await resetDb()
  resetStores()
})
afterEach(() => {
  app?.stop()
  app = null
})

it('starts a blank project from the code already in the editor on the first run', async () => {
  useAppStore.getState().setCode('cube(7);')
  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project).toMatchObject({ name: 'Untitled project', origin: 'blank' })
  expect(useAppStore.getState().code).toBe('cube(7);')
  expect(useSettingsStore.getState()).toMatchObject({ loaded: true, settings: { lastProjectId: useProjectStore.getState().project!.id } })
})

it('reopens the last project after a reload, with its head and chat', async () => {
  app = await startApp({ capture: async () => null })
  const first = useProjectStore.getState().project!
  await useProjectStore.getState().commit({ code: 'cube(2);', params: {}, source: 'manual', message: 'edit', model: null, compileStatus: 'ok', renderMs: 1 })
  await db.messages.put({
    id: 'm1', projectId: first.id, versionId: null, role: 'user', content: 'Make a cube', imageBlobIds: [], audioTranscript: null,
    model: null, usageId: null, createdAt: 1,
  })
  app.stop()
  resetStores()

  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project?.id).toBe(first.id)
  expect(useProjectStore.getState().head?.label).toBe('v2')
  expect(useAppStore.getState().code).toBe('cube(2);')
  await vi.waitFor(() => expect(useChatStore.getState().messages.map((m) => m.text)).toEqual(['Make a cube']))
})

it('falls back to the most recent project when the last one is gone', async () => {
  app = await startApp({ capture: async () => null })
  const first = useProjectStore.getState().project!
  await useSettingsStore.getState().update({ lastProjectId: 'deleted' })
  app.stop()
  resetStores()
  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project?.id).toBe(first.id)
})

it('records versions once started: an edit plus a successful render becomes v2', async () => {
  app = await startApp({ capture: async () => null })
  useAppStore.getState().setCode('cube(3);')
  await Promise.resolve()
  const s = useAppStore.getState()
  const { okResult } = await import('../test/results')
  s.renderFinished(okResult(), s.code, s.params)
  await vi.waitFor(() => expect(useProjectStore.getState().head?.label).toBe('v2'))
})
```

Append to `src/App.test.tsx` (add `fireEvent` and `act` to its `@testing-library/react` import, and `RenderRequest`/`RenderResult` are already imported there):

```tsx
vi.mock('./history/HistoryView', () => ({ HistoryView: () => <div data-testid="history-view" /> }))
vi.mock('./gallery/GalleryView', () => ({ GalleryView: () => <div data-testid="gallery-view" /> }))

describe('M3', () => {
  it('blocks STL export from a slider change until the render with those values finishes', async () => {
    const requests: RenderRequest[] = []
    const pending: Array<() => void> = []
    const handle = {
      render: (req: RenderRequest) =>
        new Promise<RenderResult>((resolve) => {
          requests.push(req)
          if (requests.length === 1) resolve(okResult())
          else pending.push(() => resolve(okResult()))
        }),
      terminate: () => {},
    }
    render(<App createWorker={() => handle} />)
    const exportStl = () => screen.getByRole('button', { name: 'Export STL' })
    await waitFor(() => expect(exportStl()).toBeEnabled())

    fireEvent.change(screen.getByRole('slider', { name: 'width' }), { target: { value: '30' } })
    expect(exportStl()).toBeDisabled()
    expect(exportStl()).toHaveAttribute('title', 'Wait for the render to finish')
    await waitFor(() => expect(requests.at(-1)).toEqual(expect.objectContaining({ params: { width: 30 } })), { timeout: 3_000 })
    expect(exportStl()).toBeDisabled()
    act(() => pending.shift()!())
    await waitFor(() => expect(exportStl()).toBeEnabled())
  })

  it('shows the Customizer dock under the viewer and the Problems tab in the code pane', async () => {
    render(<App createWorker={scriptedWorker(() => okResult())} />)
    expect(screen.getByRole('region', { name: 'Parameters' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Dimensions' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Problems/ })).toBeInTheDocument()
  })

  it('switches to the History and Examples views', () => {
    render(<App createWorker={scriptedWorker(() => okResult())} />)
    act(() => useAppStore.getState().setView('history'))
    expect(screen.getByTestId('history-view')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '3D view' })).toBeNull()
    act(() => useAppStore.getState().setView('gallery'))
    expect(screen.getByTestId('gallery-view')).toBeInTheDocument()
    act(() => useAppStore.getState().setView('workbench'))
    expect(screen.getByRole('region', { name: '3D view' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app src/App.test.tsx`
Expected: FAIL: "Failed to resolve import './startApp'"; in the App tests no slider named "width", no "Parameters" region, no History view.

- [ ] **Step 3: Write minimal implementation**

`src/app/startApp.ts`:

```ts
import { getProject, listRecentProjects } from '../db/projects'
import { installUsageHook } from '../db/usageLinks'
import { startChatPersistence } from '../history/chatPersistence'
import { onBeforeLeaveHead, useProjectStore } from '../history/projectStore'
import { startRecorder } from '../history/recorder'
import { useSettingsStore } from '../settings/settingsStore'
import { applyTheme } from '../settings/theme'
import { useAppStore } from '../state/store'
import { captureThumbnail } from '../viewer/thumbnail'

export interface StartedApp {
  stop(): void
}

export async function startApp(deps: { capture?(): Promise<Blob | null> } = {}): Promise<StartedApp> {
  await useSettingsStore.getState().load()
  applyTheme(useSettingsStore.getState().settings.theme)
  const stopTheme = useSettingsStore.subscribe((s, prev) => {
    if (s.settings.theme !== prev.settings.theme) applyTheme(s.settings.theme)
  })

  const uninstallUsage = installUsageHook(() => useProjectStore.getState().project?.id ?? null)
  const chat = startChatPersistence()
  const recorder = startRecorder({
    capture: deps.capture ?? (() => captureThumbnail()),
    onCommit: (v) => (v.source === 'ai' || v.source === 'autofix' ? chat.linkTurn(v) : undefined),
  })
  onBeforeLeaveHead(() => recorder.flush())
  const stopProject = useProjectStore.subscribe((s, prev) => {
    if (s.project && s.project.id !== prev.project?.id) void chat.load(s.project.id)
  })

  const store = useProjectStore.getState()
  const { lastProjectId } = useSettingsStore.getState().settings
  const last = lastProjectId ? await getProject(lastProjectId) : undefined
  const fallback = last ?? (await listRecentProjects(1))[0]
  if (fallback) await store.openProject(fallback.id)
  else await store.newProject({ code: useAppStore.getState().code, origin: 'blank' })

  return {
    stop() {
      stopProject()
      onBeforeLeaveHead(null)
      recorder.stop()
      chat.stop()
      uninstallUsage()
      stopTheme()
    },
  }
}
```

`src/main.tsx`: add `import { startApp } from './app/startApp'` and, before `createRoot(…)`, the line `void startApp()`.

`src/App.tsx`: the following changes; keep everything M2 added (chat column, Settings button, settings view, Share).

1. Imports:

```tsx
import { ComposerBridge } from './chat/promptRequest'
import { CustomizerDock } from './customizer/CustomizerDock'
import { GalleryView } from './gallery/GalleryView'
import { HistoryView } from './history/HistoryView'
import { useRenderedVersionLabel } from './history/renderedVersion'
import { useSettingsStore } from './settings/settingsStore'
import { CodePane } from './workbench/CodePane'
import { HistoryControls } from './workbench/HistoryControls'
import { ProjectMenu } from './workbench/ProjectMenu'
import { RenderedFromCaption } from './workbench/RenderedFromCaption'
import { useUndoShortcuts } from './workbench/useUndoShortcuts'
```

   `CodeEditor` and `ConsolePanel` imports go away from `App.tsx` (CodePane owns them), and so do the store selectors only they used: `code`, `setCode`, `reveal` and `logs` (`noUnusedLocals` fails the typecheck otherwise; keep any M2 still uses).

2. At the top of `App`, replace `useRenderLoop(createWorker)` with:

```tsx
  const debounceMs = useSettingsStore((s) => s.settings.debounceMs)
  const timeoutMs = useSettingsStore((s) => s.settings.timeoutMs)
  useRenderLoop(createWorker, debounceMs, timeoutMs)
  useUndoShortcuts()
  const view = useAppStore((s) => s.view)
  const staleLabel = useRenderedVersionLabel()
```

   (if M2 already reads `view`, reuse its variable), and after the hooks, before the main `return`:

```tsx
  if (view === 'gallery') return <GalleryView />
```

3. Header: right after the separator that follows the `ChatSCAD` heading, add `<ProjectMenu />`. Replace `{stale && <span className="pc-caption">last model that compiled</span>}` with `{stale && <RenderedFromCaption />}`. Right before M2's Settings button (or before `<ExportButtons … />` if M2 placed nothing there), add `<HistoryControls />`.

4. Body: the element that holds the workbench columns (M1's `<main …>`, extended by M2 with the chat column) is rendered only when `view === 'workbench'`; when `view === 'history'` render `<HistoryView createWorker={createWorker} />` in its place (M2's settings branch stays as it is). Inside the workbench, replace the 3D view section with:

```tsx
        <section aria-label="3D view" className="flex min-h-0 min-w-0 flex-col">
          <div className="min-h-0 flex-1">
            <Viewer mesh={mesh} stale={stale} thumbnails staleLabel={staleLabel} />
          </div>
          <CustomizerDock />
        </section>
```

   and replace the whole `<section aria-label="Code" …>…</section>` with `<CodePane />`. If M2 put extra buttons in that section's pane head, pass them as `<CodePane actions={…} />`.

5. Mount the composer bridge once, as the last child of the root `div`: `<ComposerBridge />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npm run typecheck`
Expected: the whole unit suite passes (4 new startApp tests, 3 new App tests, the M1 and M2 App tests unchanged), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app src/main.tsx src/App.tsx src/App.test.tsx
git commit -m "feat(app): start projects and history on load; dock, code pane, History and Examples views in the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: End-to-end flow, full verification and push

**Files:**
- Create: `e2e/history.spec.ts`
- Modify: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the whole app (Tasks 1–23) in the production build with the CSP on, the real OpenSCAD WASM and the BOSL2 bundle; M2's Settings button (`aria-label="Settings"`) and settings nav (`<nav aria-label="Settings sections">`), named as on the screens.
- Produces: the M3 exit check from the spec ("start from a gallery model, tune sliders, restore any version"), plus persistence across a reload and the library path through the worker.

- [ ] **Step 1: Write the end-to-end tests**

`e2e/history.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

const RENDER_TIMEOUT = 90_000

function watchCspViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) violations.push(msg.text())
  })
  return violations
}

const versionRow = (page: Page, label: string) =>
  page.locator('.pc-version').filter({ has: page.locator('.t', { hasText: new RegExp(`^${label.replace('.', '\\.')}( · current)?$`) }) })

test('start from a gallery model, tune a slider, restore an older version, and keep it all after a reload', async ({ page }) => {
  const csp = watchCspViolations(page)
  await page.goto('./')
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })

  await page.getByRole('button', { name: 'Untitled project' }).click()
  await page.getByRole('menuitem', { name: 'Examples' }).click()
  await expect(page.getByRole('heading', { name: 'Start from a working model' })).toBeVisible()
  await page.getByRole('article', { name: 'Box with lid' }).getByRole('button', { name: 'Start from this' }).click()

  await expect(page.getByTestId('dims')).toHaveText('138 × 44 × 32 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByRole('button', { name: 'Box with lid' })).toBeVisible()
  await expect(page.getByTestId('version-caption')).toHaveText('v1 · from an example')

  await page.getByRole('slider', { name: 'inner_width' }).fill('80')
  await expect(page.getByTestId('dims')).toHaveText('178 × 44 × 32 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('version-caption')).toHaveText('v2 · edited by slider')

  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText('2 versions')).toBeVisible()
  await expect(versionRow(page, 'v2').locator('.m')).toHaveText('inner_width 60 → 80')
  await versionRow(page, 'v1').click()
  await expect(page.getByText('Preview · v1')).toBeVisible()
  await page.getByRole('button', { name: 'Restore v1' }).click()

  await expect(page.getByTestId('dims')).toHaveText('138 × 44 × 32 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('version-caption')).toHaveText('v3 · restored')

  await page.reload()
  await expect(page.getByRole('button', { name: 'Box with lid' })).toBeVisible()
  await expect(page.getByTestId('dims')).toHaveText('138 × 44 × 32 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('version-caption')).toHaveText('v3 · restored')
  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText('3 versions')).toBeVisible()
  await expect(versionRow(page, 'v3').locator('.m')).toHaveText('Restored v1')
  await expect(versionRow(page, 'v3').locator('.pc-thumb img')).toBeVisible({ timeout: RENDER_TIMEOUT })

  expect(csp).toEqual([])
})

test('a project with BOSL2 enabled renders include <BOSL2/std.scad> through the worker', async ({ page }) => {
  const csp = watchCspViolations(page)
  await page.goto('./')
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Libraries' }).click()
  await page.getByRole('checkbox', { name: 'BOSL2' }).check({ force: true })
  await page.getByRole('button', { name: 'Back to project' }).click()

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText('include <BOSL2/std.scad>\ncuboid([10, 20, 30], rounding = 2);')
  await expect(page.getByTestId('dims')).toHaveText('10 × 20 × 30 mm', { timeout: RENDER_TIMEOUT })
  expect(csp).toEqual([])
})
```

In `e2e/smoke.spec.ts`, the stale label now names the version the model came from (Task 10). In the compile-error test, replace

```ts
  await expect(page.getByText('Showing the last model that compiled')).toBeVisible()
```

with

```ts
  await expect(page.getByText('Showing v1, the last version that compiled')).toBeVisible()
```

- [ ] **Step 2: Run the end-to-end tests**

Run: `npm run e2e`
Expected: PASS (5 smoke tests + 2 history tests). The flow test checks, in order: the default model renders; Examples → Box with lid gives "138 × 44 × 32 mm" and "v1 · from an example"; moving `inner_width` to 80 gives "178 × 44 × 32 mm" and "v2 · edited by slider"; History lists "inner_width 60 → 80"; Restore v1 gives "138 × 44 × 32 mm" and "v3 · restored"; after a reload the project, head, dims, three versions, the "Restored v1" message and a stored thumbnail are all still there; no CSP violation. If a step fails, open `playwright-report/` and fix the cause in the task that owns it; do not loosen the assertion.

Run: `BASE_PATH=/chatscad/ npm run e2e`
Expected: PASS again under the GitHub Pages sub-path (library bundles and the engine `VERSION` file load from `/chatscad/`).

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: no type errors; every unit test passes (including the real-WASM tests in `src/render/openscad.wasm.test.ts` and `src/gallery/examples.wasm.test.ts`, which need `public/openscad/` and `public/libraries/`; `pretest` fetches them if missing); every end-to-end test passes. `git status` shows no file under `public/libraries/` or `public/openscad/`.

Manual check in `npm run dev` (two minutes): switch the theme in Settings › Appearance and watch the viewer follow; type in the editor, click outside it and see a new "Edited code" version in History; press Ctrl+Z outside the editor and see the head move back.

- [ ] **Step 4: Commit and push**

```bash
git add e2e/history.spec.ts e2e/smoke.spec.ts
git commit -m "test(e2e): gallery to slider to restore, persisted across a reload; BOSL2 through the worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD
```

Expected: the push succeeds; on `main` the Pages workflow runs typecheck, unit tests and the end-to-end tests (it now also caches and fetches the pinned libraries, Task 4) and deploys.

---

## Deferred from M3 (tracked for later plans)

| Item | Milestone | Hook left in M3 |
| --- | --- | --- |
| "Timelapse GIF" button in the History footer | M4 | `ancestry(head.id)` (Task 7); thumbnails and `renderMs` are stored per version; the footer row already holds "Export project (.json)" |
| Variants: generating, picking, `kind: 'variant'` versions | M4 | `createVersion` accepts `kind`/`variantGroupId`; `buildTimeline` hides variants and shows "+ N variants not picked" (Task 17) |
| Share button, `#s=` links, `origin: 'shared-link'` / `source: 'import'` | M4 | `newProject({ origin: 'shared-link', source: 'import' })` (Task 9); the recorder already labels `import` |
| Project export as a zip with thumbnails and images | M4 | `exportProject` (Task 16) skips blobs on purpose; `getBlob` exists |
| Precaching `public/libraries/*.json` offline | M4 (PWA) | Bundles are static files under `BASE_URL` (Task 4) |
| Fonts for `text()` (the M1 "Deferred" row) | M4 | `runOpenSCAD` is the one place that writes the FS (Task 5); the pinned build reads `OPENSCAD_FONT_PATH` / fontconfig from `/fonts`, so a font bundle can be written like the libraries |
| Phone parameter bottom sheet | M4 | `CustomizerDock` and `ParamRow` are self-contained (Tasks 13–14) |
| Low-`$fn` preview pass with `-D` | M4 | `buildRenderRequest` (Task 3) is the one place requests are built |
| Un-baked slider values in the AI context | M5 | AI turns clear `params` (Task 3) and the slider version before it records them (Task 11); `PromptContext` can gain the values when scoped edits arrive |
| "Ask Claude about the selection" button in the code pane head | M5 | `CodePane` takes `actions` (Task 15); `usePromptRequest` fills the composer (Task 12) |
| Code-editor autocomplete for the project's modules, format on save | Not scheduled (spec "Code editor") | `src/scad/lexer.ts` gives the tokens such features need |
| Live Dexie queries for history lists | Not needed | The project store is the single writer and updates its state after each write (Task 9) |
| `printerProfiles` table contents | Future printing features | Table reserved in schema v2 (Task 6) |

## Contract issues

Problems found in the design doc's Shared contracts. The contracts are used exactly as written; each item says how this plan copes.

1. **`ParamValue` is not defined in the contracts.** `Version.params`, `Preset.params` and `CustomizerParam.defaultValue` use it. This plan imports M1's `ParamValue` from `src/render/types.ts` (`number | boolean | string | number[]`).
2. **`Settings` has no place for the lock's salt and verifier.** The contract lists `lockMode` only, but the security design needs a stored salt ("random 16-byte salt stored in settings") and a way to tell a wrong passphrase from a right one when no profile has a key. Task 6 adds `lockSalt: string | null` and `lockVerifier: string | null`.
3. **The chat store's hook and state are not named.** The contract fixes `ChatMessage` and the file `src/chat/chatStore.ts`, not the export. Tasks 11 and 12 assume `useChatStore` with `messages: ChatMessage[]` and only use `getState`, `setState({ messages })` and `subscribe`. If M2 named it differently, re-export it under that name from `chatStore.ts`.
4. **Repository function names are not fixed.** M3 needs `getSettings`/`updateSettings` (`src/db/settings.ts`), `listProfiles`/`saveProfile` (`src/db/profiles.ts`). Task 6 gives the code to add for the settings pair; Tasks 21 and 22 state the profile pair. M2's usage writer is untouched: a Dexie `creating` hook (Task 12) fills `projectId` and links usage to versions.
5. **`lastRender` carries no parameters.** `awaitRender(code)` cannot tell two renders of the same code with different `-D` overrides apart. M3 adds `renderedParams` beside it and leaves `awaitRender` as is (AI turns clear params, so their renders are unambiguous).
6. **`nextLabel(parent, siblings)` cannot guarantee unique labels.** Continuing a branch (`v3.1` → `v3.2`) can collide with a second branch from the parent (`v3.2`). `createVersion` resolves a clash against the project's labels (Task 7); `nextLabel` keeps its signature.
7. **`AppState` has no field for the project's enabled libraries,** which the render loop needs. Task 3 adds `libraries` and `setLibraries`.
8. **The contract does not say what `setCode(code, 'ai')` does to slider values.** Keeping them would mask the defaults the AI just changed. Task 3 makes `'ai'` and `'autofix'` clear `params`.
9. **The editor echoes programmatic code back as a `'manual'` edit.** M1's `CodeEditor` reports a `value` prop change through `onChange`, which with M2's `setCode(code, source = 'manual')` relabels AI code. Task 15 annotates the sync transaction, and the recorder reads the source at the moment the code changes (Task 11).
10. **`ChatMessage.turnLabel` is set by M2 per session turn.** M3 must own it. Task 12 keeps the version label on the turn's last reply even if M2 rewrites the message, without editing M2's turn logic.
11. **"Back to vN" (M2) is not specified in the contract.** M3 assumes it calls `setCode(oldCode, 'restore')`; the recorder then records "Restored vN" (Task 11). If M2 used another path, call `useProjectStore.getState().restore(versionId)` there instead.
12. **`VersionSource` has no value for a blank start.** A new blank project's version 1 is `source: 'manual'`, message "New project".
