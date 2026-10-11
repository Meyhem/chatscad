# PromptCAD M1 — Render Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite + React (TSX) app, styled from the PromptCAD design system, where you paste OpenSCAD into a CodeMirror editor, it compiles in a Web Worker with OpenSCAD WASM (Manifold backend), the mesh shows in a three.js viewer with mm dimensions, and you can download binary STL and the `.scad` source.

**Architecture:** All work is client-side. A single `RenderController` is the only path to the render worker; it owns debounce (600 ms), cancellation (a newer request terminates the in-flight worker) and the 60 s timeout. The worker (Comlink) creates a fresh OpenSCAD WASM instance per render, writes `/main.scad`, runs `callMain`, parses the binary STL into typed arrays and transfers them back. A Zustand store holds code, render status, the last good mesh/STL, logs, diagnostics and a "reveal this line" request; React components (`.tsx`) render from it. Every colour, radius, font and size comes from `design/tokens.json`, generated into CSS custom properties; the design system's `pc-*` component classes are used as-is from `design/components.css`, and Tailwind v4 is used for layout with a token-backed theme.

**Tech Stack:** Vite, React 19, TypeScript (strict, `.tsx` components), Tailwind CSS v4 (`@tailwindcss/vite`), Zustand, Comlink, CodeMirror 6, three.js via `@react-three/fiber` + `@react-three/drei`, OpenSCAD WASM (official WebAssembly snapshot build), `@fontsource-variable/archivo` + `@fontsource/jetbrains-mono` (self-hosted fonts), `lucide-react` (icons), Vitest + Testing Library (jsdom), Playwright, `tsx` for Node scripts, `fflate` for unzipping.

**Spec:** [`docs/SPEC.md`](../../SPEC.md). This plan implements Milestone 1 ("Render core") plus the cross-cutting rules from "Rendering pipeline", "Security" and "Tech stack" that M1 code touches.

**Design sources:** the PromptCAD design system and screens, copied into [`design/`](../../../design/README.md) (`tokens.json`, `components.css`) so every task can read them. Originals: design system https://claude.ai/artifact/Ww9x79XKgeaW9w19vs13io and screens https://claude.ai/artifact/TNXkMGKfbuVrEAh8MEvMDA. M1 builds the **Workbench** screen without its chat column, the **Compile error** screen's status pill, stale viewer, editor gutter and inline callout, and the **First run** screen's "Loading OpenSCAD…" state. Chat, Customizer dock, history, settings, share, the export dialog and the phone tab bar belong to later milestones (see "Deferred from M1").

## Global Constraints

From the spec:

- No backend: the build output is static files only ("nothing needs a server beyond static hosting").
- TypeScript `strict`; every React component is a `.tsx` file; Node scripts are `.ts` run with `tsx`.
- Rendering: "OpenSCAD WASM in a Web Worker", compile "with `--backend=manifold`, parameter overrides as `-D name=value`".
- "Each render runs in a dedicated Web Worker with a fresh OpenSCAD WASM instance, so a hung or crashed compile is killed by terminating the worker."
- Editor changes are "debounced ~600 ms, configurable. A newer request cancels the in-flight one."
- "Default timeout 60 s (setting)." "Last good mesh stays on screen when a compile fails."
- Display: "auto-fit camera on first render, keep the camera on re-renders, show bounding-box dimensions in mm." OpenSCAD is Z-up.
- Report: "stdout/stderr, warnings, `echo()` output and render time to a console panel; map error line numbers back into the editor as diagnostics."
- Export: "STL (binary) is the v1 target"; ".scad source" too. "On mobile, use the Web Share API with a file, falling back to a download link."
- Security: "`script-src 'self' 'wasm-unsafe-eval'`" … "No analytics, no CDN scripts." All assets (including the OpenSCAD WASM and both fonts) are self-hosted. Do not use drei helpers that fetch from a CDN (`Environment` presets, remote fonts).
- "Model output is untrusted. Generated code only ever runs inside the OpenSCAD WASM sandbox; never `eval`, never rendered as HTML." Console and editor callout text are rendered as text nodes only.
- Units are millimetres.

From the design system (`design/tokens.json`, its README and component docs):

- "Build every surface from tokens and never hard-code a hex." No hex literals and no Tailwind palette classes (`neutral-800`, `red-400`, …) anywhere in `src/` except the generated `src/styles/tokens.css`. A test enforces this (Task 2).
- "Dark is the primary theme (`dark`); `light` is a full peer." Dark is `:root`; light applies via `[data-theme="light"]` or the OS preference. Viewer colours (WebGL cannot read CSS variables) are read from the computed style and re-read when the theme changes.
- Surfaces: app ground `bg`, panels `panel`, wells (editor, console) `inset`, 3D view `viewport`; panels are separated by 1px `line` borders, never shadows.
- "`accent` marks what the person is working on": the one primary button per region (Export STL in the header), keyboard focus (`focus-ring`), selection. "`filament` is the model" and nothing else.
- Status "always carries an icon and a word", using `ok` / `warn` / `error` on their `*-soft` grounds. "The last good model stays on screen when a render fails; the failure shows in the status pill, the console and the editor gutter, never as a modal."
- Type: Archivo for the interface, JetBrains Mono for code, readouts and the console, self-hosted via `@fontsource-variable/archivo` and `@fontsource/jetbrains-mono`. Every changing number sits in mono with tabular figures.
- Voice: sentence case everywhere ("Export STL", "Fit view"); numbers always carry their unit ("20 × 20 × 10 mm", "Rendered 412 ms", "Timed out after 60 s") with the multiplication sign `×`; errors "say what failed, where, and what to do"; no exclamation marks, no emoji; never "head", "blob", "AST" in the UI.
- Icons: 16px line icons, 1.5px stroke, square caps, `currentColor`, from Lucide (`lucide-react`, bundled, no CDN), always with the `pc-i` class so `components.css` sizes them.
- Controls are `control-md` (36px) on desktop and at least `touch-target` (44px) on coarse pointers; `components.css` handles this for `pc-*` controls.
- Corners: `radius-sm` inputs and chips, `radius-md` buttons, `radius-lg` dialogs, `radius-pill` only for status pills and switches.
- Wordmark only: "There is no logo yet. Set the name 'PromptCAD' in Archivo 700 and never draw a stand-in mark."

## Review Focus

1. **Runaway model** (`for (i=[0:1e9]) cube(1);`, `$fn=1e6`). Expected: after 60 s the render stops, the status pill says "Timed out after 60 s", the console shows the same, the last good mesh stays (dimmed, with "Showing the last model that compiled"), and the next edit renders normally in a new worker. *Pinned in Task 7 (timeout and respawn tests), Task 10 (StatusPill timeout label) and Task 11 (stale model opacity).*
2. **Fast typing.** Expected: only the latest code's result is ever shown, and a slow older result arriving late is discarded. *Pinned in Task 7 (stale-result test).*
3. **Code that produces no geometry** (empty file, only comments, `echo("hi");`). Expected: a plain "produced no output / model is empty" message in the pill tooltip and console with no crash, and the last mesh stays. *Pinned in Task 6 (no-output and zero-triangle tests), Task 8 (store keeps mesh) and Task 10 (console summary line).*
4. **Export while the code is broken or still rendering.** Expected: Export STL is disabled with a tooltip saying why ("Fix the error first, so the file matches the code" / "Wait for the render to finish"), so you never download geometry that doesn't match the editor. Export .scad stays enabled. *Pinned in Task 8 (`selectCanExport`), Task 12 (disabled reason) and Task 13 (App test).*
5. **HTML-looking text in model output** (`echo("<img src=x onerror=alert(1)>")`). Expected: it shows as literal text in the console and in the editor's inline callout, and no element is created. *Pinned in Task 10 (ConsolePanel test) and Task 9 (callout widget uses `textContent`).*

## Design fidelity checks

Rules from the design system that no spec requirement covers, each pinned to a test:

| Rule (source) | Where it is enforced |
| --- | --- |
| No hard-coded colours; tokens only (README "Colour") | Task 2: `src/styles/noHardcodedColors.test.ts` scans `src/` for hex literals and palette classes |
| `tokens.css` is generated from `design/tokens.json`, not edited (README "Colour") | Task 2: `scripts/gen-tokens.test.ts` compares the committed file with the generator's output |
| Light theme is a full peer; viewer follows it (README "Colour") | Task 2: `useTokens` re-reads on theme change; Task 13 e2e: `body` background under `colorScheme: 'light'` |
| Status pill is always icon + word; failure names the line and jumps to it (StatusPill) | Task 10: StatusPill tests, including the click handler |
| Console lines are text only, toned, and ERROR/WARNING lines link to the editor (Console) | Task 10: ConsolePanel tests |
| A render failure is never a modal (README "Layout", Dialog) | Task 13: App test asserts no `role="dialog"` after a failed render |
| Export STL is disabled while rendering or failed, with the reason; .scad stays enabled (Button) | Task 12: ExportButtons tests |
| Dimensions round to two decimals, drop trailing zeros, and stay put on failure (DimsReadout) | Task 5: `formatDims` tests; Task 13: App test |

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, playwright.config.ts
design/README.md                 where the design files come from and how to refresh them
design/tokens.json               design tokens (copied verbatim from the design system)
design/components.css            pc-* component classes (copied; Google Fonts import removed)
build/csp.ts                     Vite plugin: inject CSP <meta> into production HTML
build/csp.test.ts
scripts/fetch-openscad.ts        tsx script: download OpenSCAD WASM into public/openscad/
scripts/fetch-openscad.test.ts
scripts/gen-tokens.ts            tsx script: design/tokens.json → src/styles/tokens.css (+ Tailwind @theme)
scripts/gen-tokens.test.ts
public/openscad/                 (git-ignored) openscad.js, openscad.wasm, VERSION
src/main.tsx                     React entry; imports the fonts and index.css
src/App.tsx                      header + workbench layout + wiring
src/App.test.tsx
src/index.css                    Tailwind, tokens, components layer, body defaults
src/styles/tokens.css            GENERATED: :root (dark), [data-theme="light"], prefers-color-scheme, @theme inline
src/styles/noHardcodedColors.test.ts
src/theme/tokens.ts              readToken(), useTokens() for WebGL colours that follow the theme
src/theme/tokens.test.ts
src/ui/icons.ts                  the Lucide icons M1 uses, re-exported
src/ui/StatusPill.tsx            pc-status: icon + word, render time in mono, click → line
src/ui/StatusPill.test.tsx
src/ui/DimsReadout.tsx           pc-dims: "20 × 20 × 10 mm" or the axis form "X 20 Y 20 Z 10 mm"
src/ui/DimsReadout.test.tsx
src/test/setup.ts                jest-dom matchers, jsdom shims for CodeMirror
src/test/stl.ts                  STL fixture builders (shared by tests)
src/test/results.ts              RenderResult fixtures (shared by tests)
src/render/types.ts              RenderRequest, RenderResult, MeshData, Bounds, LogLine, Diagnostic, ParamValue
src/render/result.ts             failedResult(), errorMessage()
src/render/args.ts               buildArgs(), formatParamValue(), INPUT_PATH, OUTPUT_PATH
src/render/diagnostics.ts        parseDiagnosticLine(), parseDiagnostics()
src/render/stl.ts                parseStl()
src/render/dims.ts               formatDimParts(), formatDims()
src/render/runOpenSCAD.ts        one compile against an injected OpenSCAD factory (pure, testable)
src/render/render.worker.ts      Comlink glue: loads /openscad/openscad.js, calls runOpenSCAD
src/render/createRenderWorker.ts real WorkerFactory (new Worker + Comlink.wrap)
src/render/controller.ts         RenderController: debounce, cancel, timeout, respawn
src/render/useRenderLoop.ts      hook: store.code → controller → store
src/state/store.ts               Zustand store, DEFAULT_CODE, selectCanExport, goToLine
src/editor/openscadLanguage.ts   CodeMirror StreamLanguage for OpenSCAD
src/editor/theme.ts              editor chrome + syntax colours from tokens (syn-*)
src/editor/diagnosticsExtension.ts  error line ground, gutter number colour, inline pc-callout widget
src/editor/CodeEditor.tsx        CodeMirror wrapper + toCmDiagnostics() + reveal-line
src/viewer/geometry.ts           meshToGeometry()
src/viewer/cameraFit.ts          computeCameraFit()
src/viewer/Viewer.tsx            Canvas, grid, axes, gizmo, model (filament), overlays, Fit view
src/panels/ConsolePanel.tsx      pc-console: toned log lines, clickable error lines, summary line
src/export/saveFile.ts           Web Share with file → download fallback
src/export/ExportButtons.tsx     Export STL (primary) / Export .scad
e2e/smoke.spec.ts                Playwright: real WASM, production build, CSP on, light theme
```

---

### Task 1: Project scaffold (Vite + React TSX + Tailwind + Vitest)

**Files:**
- Create: `package.json` (via npm), `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/test/setup.ts`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (Vitest, jsdom, globals), `npm run typecheck`, `npm run build`, `npm run dev`; the `App` component exported from `src/App.tsx`.

- [ ] **Step 1: Create package.json and install dependencies**

Run from the repo root (it already has `README.md`, `docs/`, `design/` and `.gitignore`):

```bash
npm init -y
npm pkg set name=promptcad private=true type=module version=0.0.0
npm pkg delete main scripts.test
npm i react react-dom
npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event tsx
npm pkg set scripts.dev="vite" scripts.build="tsc --noEmit && vite build" scripts.preview="vite preview" scripts.test="vitest run" scripts.test:watch="vitest" scripts.typecheck="tsc --noEmit"
```

- [ ] **Step 2: Write config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "node"]
  },
  "include": ["src", "scripts", "build", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'build/**/*.test.ts'],
  },
})
```

`index.html` (no colour classes here; Task 2 styles `body` from tokens):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>PromptCAD</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/index.css` (Task 2 replaces this):

```css
@import "tailwindcss";

html,
body,
#root {
  height: 100%;
}
```

`src/test/setup.ts`. CodeMirror measures text with `Range` geometry, which jsdom doesn't implement:

```ts
import '@testing-library/jest-dom/vitest'

const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect

if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => emptyRect
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: Write the failing test**

`src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { App } from './App'

it('shows the app name', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'PromptCAD' })).toBeInTheDocument()
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, because `./App` can't be resolved.

- [ ] **Step 5: Write minimal App**

`src/App.tsx`:

```tsx
export function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-3 py-2">
        <h1 className="font-semibold">PromptCAD</h1>
      </header>
    </div>
  )
}
```

- [ ] **Step 6: Verify tests, typecheck and build pass**

Run: `npm test && npm run typecheck && npm run build`
Expected: 1 test passes, no type errors, and `dist/` is produced.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src
git commit -m "chore: scaffold Vite + React TSX app with Tailwind and Vitest"
```

---

### Task 2: Design tokens, fonts and component styles

**Files:**
- Create: `scripts/gen-tokens.ts`, `src/styles/tokens.css` (generated), `src/theme/tokens.ts`, `src/ui/icons.ts`
- Modify: `src/index.css`, `src/main.tsx`, `src/App.tsx`, `package.json` (scripts)
- Test: `scripts/gen-tokens.test.ts`, `src/styles/noHardcodedColors.test.ts`, `src/theme/tokens.test.ts`

**Interfaces:**
- Consumes: `design/tokens.json`, `design/components.css` (already in the repo; see `design/README.md`).
- Produces:
  - `tokensToCss(tokens: DesignTokens): string` and the `DesignTokens` type (in `scripts/gen-tokens.ts`); npm script `tokens`
  - CSS custom properties `--bg`, `--panel`, `--inset`, `--viewport`, `--line`, `--ink`, `--accent`, `--filament`, `--ok`, `--warn`, `--error`, `--*-soft`, `--grid-minor`, `--grid-major`, `--axis-x/y/z`, `--syn-*`, `--space-*`, `--radius-*`, `--shadow-pop`, `--control-sm`, `--control-md`, `--touch-target`, `--header-height`, `--font-sans`, `--font-mono` on `:root`
  - Tailwind utilities backed by those tokens: `bg-bg`, `bg-panel`, `bg-inset`, `bg-viewport`, `border-line`, `text-ink`, `text-ink-muted`, `text-accent`, `font-sans`, `font-mono`, `rounded-sm/md/lg/pill`, `shadow-pop`; the default Tailwind palette is removed
  - `readToken(name: string): string` and `useTokens<N extends string>(names: readonly N[]): Record<N, string>` (in `src/theme/tokens.ts`)
  - Icons re-exported from `src/ui/icons.ts`: `IconCheck`, `IconX`, `IconWarning`, `IconSpinner`, `IconDownload`, `IconFit`

The design system ships colours for two themes. Dark is primary, so it lives on `:root`; light applies when `<html data-theme="light">` is set (a setting arrives in M3) or when the OS prefers light and nothing forces dark. `@theme inline` tells Tailwind v4 to generate utilities that point at the variables, so `bg-panel` follows the theme at runtime.

- [ ] **Step 1: Install fonts and icons**

```bash
npm i @fontsource-variable/archivo @fontsource/jetbrains-mono lucide-react
npm pkg set scripts.tokens="tsx scripts/gen-tokens.ts"
```

- [ ] **Step 2: Write the failing generator tests**

`scripts/gen-tokens.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { tokensToCss, type DesignTokens } from './gen-tokens'

const tokens: DesignTokens = {
  color: {
    themes: [{ id: 'dark' }, { id: 'light' }],
    tokens: [
      { name: 'bg', value: { dark: '#0d1015', light: '#eef1f4' } },
      { name: 'accent', value: { dark: '#6e9bff', light: '#1f4fd1' } },
      { name: 'focus-ring', value: { dark: '{accent}', light: '{accent}' } },
      { name: 'filament', value: '#e9a23b' },
    ],
  },
  type: { families: { sans: '"Archivo", sans-serif', mono: '"JetBrains Mono", monospace' } },
  spacing: { tokens: [{ name: 'space-1', value: '4px' }] },
  radius: { tokens: [{ name: 'radius-sm', value: '3px' }] },
  shadow: { tokens: [{ name: 'shadow-pop', value: { dark: '0 12px 32px rgba(0, 0, 0, 0.55)', light: '0 12px 32px rgba(16, 21, 28, 0.16)' } }] },
  size: { tokens: [{ name: 'control-md', value: '36px' }] },
}

const css = tokensToCss(tokens)
const section = (selector: string) => {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no block for ${selector}`)
  return css.slice(start, css.indexOf('\n}', start))
}

it('puts the primary (dark) theme on :root with every family', () => {
  const root = section(':root')
  expect(root).toContain('color-scheme: dark;')
  expect(root).toContain('--bg: #0d1015;')
  expect(root).toContain('--filament: #e9a23b;')
  expect(root).toContain('--shadow-pop: 0 12px 32px rgba(0, 0, 0, 0.55);')
  expect(root).toContain('--space-1: 4px;')
  expect(root).toContain('--radius-sm: 3px;')
  expect(root).toContain('--control-md: 36px;')
})

it('resolves {alias} values to var() references', () => {
  expect(section(':root')).toContain('--focus-ring: var(--accent);')
})

it('prepends the fontsource variable family name to the sans stack', () => {
  expect(section(':root')).toContain('--font-sans: "Archivo Variable", "Archivo", sans-serif;')
  expect(section(':root')).toContain('--font-mono: "JetBrains Mono", monospace;')
})

it('emits the light theme for data-theme and for the OS preference, inheriting single values', () => {
  const forced = section('[data-theme="light"]')
  expect(forced).toContain('color-scheme: light;')
  expect(forced).toContain('--bg: #eef1f4;')
  expect(forced).toContain('--filament: #e9a23b;')
  expect(css).toContain('@media (prefers-color-scheme: light) {\n  :root:not([data-theme="dark"]) {')
  expect(forced).not.toContain('--space-1') // spacing is not themed
})

it('maps colours, fonts, radii and shadows into the Tailwind theme and drops the default palette', () => {
  expect(css).toContain('@theme {\n  --color-*: initial;\n  --font-*: initial;\n  --shadow-*: initial;\n}')
  const theme = section('@theme inline')
  expect(theme).toContain('--color-bg: var(--bg);')
  expect(theme).toContain('--color-focus-ring: var(--focus-ring);')
  expect(theme).toContain('--font-sans: var(--font-sans);')
  expect(theme).toContain('--radius-sm: var(--radius-sm);')
  expect(theme).toContain('--shadow-pop: var(--shadow-pop);')
  expect(theme).not.toContain('--space-1')
})

it('src/styles/tokens.css is up to date with design/tokens.json (run `npm run tokens`)', async () => {
  const source = JSON.parse(await readFile(new URL('../design/tokens.json', import.meta.url), 'utf8')) as DesignTokens
  const committed = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  expect(committed).toBe(tokensToCss(source))
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run scripts/gen-tokens.test.ts`
Expected: FAIL, because `./gen-tokens` can't be resolved.

- [ ] **Step 4: Write the generator**

`scripts/gen-tokens.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ThemedValue = Record<string, string>
export interface TokenEntry {
  name: string
  value: string | ThemedValue
  usage?: string
}
interface TokenFamily {
  tokens: TokenEntry[]
}
export interface DesignTokens {
  color: { themes: { id: string; name?: string }[]; tokens: TokenEntry[] }
  type: { families: Record<string, string> }
  spacing?: TokenFamily
  radius?: TokenFamily
  shadow?: TokenFamily
  size?: TokenFamily
}

const TOKENS_PATH = fileURLToPath(new URL('../design/tokens.json', import.meta.url))
const OUT_PATH = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url))

/** fontsource ships Archivo as a variable font registered under this family name. */
const FONT_PREPEND: Record<string, string> = { sans: '"Archivo Variable"' }

const cssValue = (v: string) => v.replace(/\{([A-Za-z0-9_.-]+)\}/g, 'var(--$1)')

function pick(value: string | ThemedValue, theme: string, primary: string): string {
  if (typeof value === 'string') return value
  const v = value[theme] ?? value[primary]
  if (v === undefined) throw new Error(`Token has no value for theme "${theme}" or "${primary}"`)
  return v
}

function block(selector: string, lines: string[], indent = ''): string {
  return `${indent}${selector} {\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`
}

export function tokensToCss(t: DesignTokens): string {
  const [primary, ...others] = t.color.themes.map((th) => th.id)
  if (!primary) throw new Error('tokens.json declares no colour themes')
  const themedFamilies = [t.color, t.shadow].flatMap((f) => f?.tokens ?? [])
  const unthemedFamilies = [t.spacing, t.radius, t.size].flatMap((f) => f?.tokens ?? [])

  const themed = (theme: string) => [
    `color-scheme: ${theme};`,
    ...themedFamilies.map((tok) => `--${tok.name}: ${cssValue(pick(tok.value, theme, primary))};`),
  ]
  const unthemed = [
    ...Object.entries(t.type.families).map(
      ([k, stack]) => `--font-${k}: ${[FONT_PREPEND[k], stack].filter(Boolean).join(', ')};`,
    ),
    ...unthemedFamilies.map((tok) => `--${tok.name}: ${cssValue(pick(tok.value, primary, primary))};`),
  ]
  const tailwind = [
    ...t.color.tokens.map((tok) => `--color-${tok.name}: var(--${tok.name});`),
    ...Object.keys(t.type.families).map((k) => `--font-${k}: var(--font-${k});`),
    ...(t.radius?.tokens ?? []).map((tok) => `--${tok.name}: var(--${tok.name});`),
    ...(t.shadow?.tokens ?? []).map((tok) => `--${tok.name}: var(--${tok.name});`),
  ]

  return [
    '/* Generated from design/tokens.json by scripts/gen-tokens.ts. Do not edit; run `npm run tokens`. */',
    block(':root', [...themed(primary), ...unthemed]),
    ...others.flatMap((id) => [
      block(`[data-theme="${id}"]`, themed(id)),
      `@media (prefers-color-scheme: ${id}) {\n${block(`:root:not([data-theme="${primary}"])`, themed(id), '  ')}\n}`,
    ]),
    block('@theme', ['--color-*: initial;', '--font-*: initial;', '--shadow-*: initial;']),
    block('@theme inline', tailwind),
  ].join('\n\n') + '\n'
}

async function main(): Promise<void> {
  const tokens = JSON.parse(await readFile(TOKENS_PATH, 'utf8')) as DesignTokens
  await writeFile(OUT_PATH, tokensToCss(tokens))
  console.log(`Wrote ${OUT_PATH}`)
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
```

- [ ] **Step 5: Generate the stylesheet and run the generator tests**

```bash
mkdir -p src/styles
npm run tokens
head -5 src/styles/tokens.css
```

Expected: the file starts with the "Generated from" comment and `:root {` with `color-scheme: dark;`.

Run: `npx vitest run scripts/gen-tokens.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the failing no-hard-coded-colours test**

`src/styles/noHardcodedColors.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const HEX = /#[0-9a-fA-F]{3,8}\b/
const PALETTE =
  /\b(?:bg|text|border|fill|stroke|ring|outline|from|via|to|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])),
  )
  return files.flat()
}

it('src uses design tokens: no hex literals, no Tailwind palette classes', async () => {
  const offenders: string[] = []
  for (const file of await walk(SRC)) {
    if (!/\.(tsx?|css)$/.test(file) || /\.test\.tsx?$/.test(file) || file.endsWith('styles/tokens.css')) continue
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (HEX.test(line) || PALETTE.test(line)) offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`)
    })
  }
  expect(offenders).toEqual([])
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/styles`
Expected: PASS. Nothing in `src/` names a colour yet, so this guard starts green; it exists to fail the moment a later task writes a hex value or a palette class. To see it bite once, add `className="bg-neutral-900"` to the header in `src/App.tsx`, run it again (FAIL, naming `App.tsx` and the line), then remove the class.

- [ ] **Step 8: Wire the stylesheet, fonts and body defaults**

Replace `src/index.css`. The component classes go into Tailwind's `components` layer so that `utilities` (layout classes in TSX) win over `.pc-root`'s own background:

```css
@import "tailwindcss";
@import "./styles/tokens.css";
@import "../design/components.css" layer(components);

@layer base {
  html,
  body,
  #root {
    height: 100%;
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 20px;
    -webkit-font-smoothing: antialiased;
  }
}
```

`src/main.tsx`: add the font imports above `./index.css`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/archivo'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx` (still a placeholder; Task 13 builds the real layout). `pc-root` enables the `svg.pc-i` icon sizing from `components.css`; the header is a `panel` 48px tall per the screens' `topbar`:

```tsx
export function App() {
  return (
    <div className="pc-root flex h-full flex-col bg-bg text-ink">
      <header className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-line bg-panel pl-4 pr-3">
        <h1 className="text-[15px] font-bold tracking-tight">PromptCAD</h1>
      </header>
    </div>
  )
}
```

- [ ] **Step 9: Write the failing token-reader tests**

The viewer (Task 11) draws in WebGL, which cannot read CSS variables, so it needs the computed values and must re-read them when the theme changes.

`src/theme/tokens.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { readToken, useTokens } from './tokens'

const values: Record<string, string> = { '--filament': ' #e9a23b ', '--viewport': '#0b0e12' }

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => values[name] ?? '',
  } as unknown as CSSStyleDeclaration)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

it('reads a trimmed token value from the root element', () => {
  expect(readToken('filament')).toBe('#e9a23b')
  expect(readToken('missing')).toBe('')
})

it('returns every requested token', () => {
  const { result } = renderHook(() => useTokens(['filament', 'viewport'] as const))
  expect(result.current).toEqual({ filament: '#e9a23b', viewport: '#0b0e12' })
})

it('re-reads when data-theme changes on <html>', async () => {
  const { result } = renderHook(() => useTokens(['filament'] as const))
  values['--filament'] = '#d4861a'
  act(() => document.documentElement.setAttribute('data-theme', 'light'))
  await waitFor(() => expect(result.current.filament).toBe('#d4861a'))
})
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npx vitest run src/theme`
Expected: FAIL, because `./tokens` can't be resolved.

- [ ] **Step 11: Implement the token reader and the icon set**

`src/theme/tokens.ts`:

```ts
import { useEffect, useState } from 'react'

/** Computed value of a design token (`--name`) on <html>, trimmed. Empty string if unset. */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
}

function readAll<N extends string>(names: readonly N[]): Record<N, string> {
  return Object.fromEntries(names.map((n) => [n, readToken(n)])) as Record<N, string>
}

/**
 * Token values for code that cannot use CSS variables (WebGL materials, canvas).
 * Re-reads when the OS colour scheme flips or `data-theme` changes on <html>.
 */
export function useTokens<N extends string>(names: readonly N[]): Record<N, string> {
  const key = names.join(',')
  const [values, setValues] = useState(() => readAll(names))

  useEffect(() => {
    const update = () => setValues(readAll(key.split(',') as N[]))
    update()
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
    media?.addEventListener('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media?.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [key])

  return values
}
```

`src/ui/icons.ts`. One place to swap icons; every use passes `className="pc-i"` so `components.css` sets the 16px size, 1.5px stroke and square caps:

```ts
export {
  Check as IconCheck,
  Download as IconDownload,
  LoaderCircle as IconSpinner,
  Scan as IconFit,
  TriangleAlert as IconWarning,
  X as IconX,
} from 'lucide-react'
```

- [ ] **Step 12: Run all tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass (including the no-hard-coded-colours scan and the tokens.css up-to-date check), no type errors, `dist/` contains hashed `.woff2` files for Archivo and JetBrains Mono.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json scripts/gen-tokens.ts scripts/gen-tokens.test.ts src/styles src/theme src/ui src/index.css src/main.tsx src/App.tsx
git commit -m "feat(design): generate token CSS from design/tokens.json, self-hosted fonts, pc-* components, token reader"
```

---

### Task 3: OpenSCAD WASM fetch script (run with tsx)

**Files:**
- Create: `scripts/fetch-openscad.ts`
- Modify: `.gitignore`, `package.json` (scripts)
- Test: `scripts/fetch-openscad.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `public/openscad/openscad.js` (ES module whose default export is the Emscripten factory), `public/openscad/openscad.wasm`, `public/openscad/VERSION`; exported `pickLatestWasmZip(html: string): string | null`; npm scripts `fetch:openscad`, `predev`, `prebuild`.

The official WebAssembly builds are published as `OpenSCAD-<date>…-WebAssembly-web.zip` in `https://files.openscad.org/snapshots/`. Only recent snapshots support `--backend=manifold`, so the script picks the newest one. Set `OPENSCAD_WASM_URL` to pin a specific zip.

- [ ] **Step 1: Write the failing test**

`scripts/fetch-openscad.test.ts`:

```ts
import { pickLatestWasmZip } from './fetch-openscad'

const listing = `
<a href="OpenSCAD-2025.01.19.ai22731-WebAssembly-web.zip">x</a>
<a href="OpenSCAD-2025.03.02.ai23104-WebAssembly-web.zip">x</a>
<a href="OpenSCAD-2025.03.02.ai23104-WebAssembly-node.zip">x</a>
<a href="OpenSCAD-2024.12.30.ai22600-x86_64.AppImage">x</a>
<a href="OpenSCAD-2025.03.02.ai23099-WebAssembly-web.zip">x</a>`

it('picks the newest web WebAssembly zip', () => {
  expect(pickLatestWasmZip(listing)).toBe('OpenSCAD-2025.03.02.ai23104-WebAssembly-web.zip')
})

it('returns null when no web zip is listed', () => {
  expect(pickLatestWasmZip('<a href="OpenSCAD-2025.01.01-x86_64.AppImage">')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/fetch-openscad.test.ts`
Expected: FAIL, because the module can't be resolved.

- [ ] **Step 3: Install fflate and write the script**

```bash
npm i -D fflate
```

`scripts/fetch-openscad.ts`:

```ts
import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const SNAPSHOTS_URL = 'https://files.openscad.org/snapshots/'
const OUT_DIR = fileURLToPath(new URL('../public/openscad/', import.meta.url))
const REQUIRED = ['openscad.js', 'openscad.wasm'] as const

export function pickLatestWasmZip(html: string): string | null {
  const matches = html.matchAll(/OpenSCAD-\d{4}\.\d{2}\.\d{2}[^"'<>\s]*?-WebAssembly-web\.zip/g)
  const names = [...new Set([...matches].map((m) => m[0]))]
  names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  return names.at(-1) ?? null
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  return res
}

async function main(): Promise<void> {
  const ifMissing = process.argv.includes('--if-missing')
  if (ifMissing && (await Promise.all(REQUIRED.map((f) => exists(OUT_DIR + f)))).every(Boolean)) {
    console.log('OpenSCAD WASM already present in public/openscad/')
    return
  }

  let url = process.env.OPENSCAD_WASM_URL
  if (!url) {
    const name = pickLatestWasmZip(await (await fetchOk(SNAPSHOTS_URL)).text())
    if (!name) throw new Error(`No *-WebAssembly-web.zip found at ${SNAPSHOTS_URL}; set OPENSCAD_WASM_URL`)
    url = SNAPSHOTS_URL + name
  }

  console.log(`Downloading ${url}`)
  const files = unzipSync(new Uint8Array(await (await fetchOk(url)).arrayBuffer()))
  await mkdir(OUT_DIR, { recursive: true })
  for (const wanted of REQUIRED) {
    const entry = Object.keys(files).find((path) => path.split('/').pop() === wanted)
    if (!entry) throw new Error(`${wanted} not found in zip. Entries: ${Object.keys(files).join(', ')}`)
    await writeFile(OUT_DIR + wanted, files[entry]!)
  }
  await writeFile(OUT_DIR + 'VERSION', `${url}\n`)
  console.log(`OpenSCAD WASM written to ${OUT_DIR}`)
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/fetch-openscad.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire scripts, ignore the output, and fetch for real**

```bash
npm pkg set scripts.fetch:openscad="tsx scripts/fetch-openscad.ts" scripts.predev="tsx scripts/fetch-openscad.ts --if-missing" scripts.prebuild="tsx scripts/fetch-openscad.ts --if-missing"
printf 'public/openscad/\n' >> .gitignore
npm run fetch:openscad
ls -la public/openscad
```

Expected: `openscad.js`, `openscad.wasm` (several MB) and `VERSION`. If the listing format changed and no zip is found, open `https://files.openscad.org/snapshots/` in a browser, pick the newest `*-WebAssembly-web.zip`, and re-run with `OPENSCAD_WASM_URL=<full url> npm run fetch:openscad`.

Check that the build is an ES module with a default export:

Run: `grep -c "export default" public/openscad/openscad.js`
Expected: `1` or more. If it is `0`, stop and report: the worker in Task 6 imports it as an ES module.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-openscad.ts scripts/fetch-openscad.test.ts package.json package-lock.json .gitignore
git commit -m "build: fetch OpenSCAD WASM snapshot into public/openscad via tsx script"
```

---

### Task 4: Render types, OpenSCAD arguments and diagnostics parsing

**Files:**
- Create: `src/render/types.ts`, `src/render/result.ts`, `src/render/args.ts`, `src/render/diagnostics.ts`
- Test: `src/render/args.test.ts`, `src/render/diagnostics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types: `ParamValue`, `RenderRequest { code: string; params?: Record<string, ParamValue> }`, `Bounds`, `MeshData`, `LogLine`, `Diagnostic`, `RenderResult` (discriminated on `ok`).
  - `INPUT_PATH = '/main.scad'`, `OUTPUT_PATH = '/out.stl'`
  - `buildArgs(params?: Record<string, ParamValue>): string[]`, which throws on an invalid parameter name or a non-finite number
  - `formatParamValue(value: ParamValue): string`
  - `parseDiagnosticLine(text: string): Diagnostic | null` (one console line → diagnostic, used by the console to make lines clickable)
  - `parseDiagnostics(logs: LogLine[]): Diagnostic[]`
  - `failedResult(error: string, opts?: { logs?: LogLine[]; renderMs?: number }): RenderResult`
  - `errorMessage(e: unknown): string`

The design system's voice for errors is "what failed, where, and what to do", shown as "Line 7: syntax error". OpenSCAD's own text embeds the location mid-sentence (`Parser error in file "/main.scad", line 3: syntax error`), so `Diagnostic.message` strips the location clause and the UI prefixes `Line N:` itself.

- [ ] **Step 1: Write the types (no behaviour, no test)**

`src/render/types.ts`:

```ts
export type ParamValue = number | boolean | string | number[]

export interface RenderRequest {
  code: string
  params?: Record<string, ParamValue>
}

export type Vec3 = [number, number, number]

export interface Bounds {
  min: Vec3
  max: Vec3
}

export interface MeshData {
  /** Non-indexed triangle soup: 9 floats per triangle. */
  positions: Float32Array
  /** Flat per-face normals, same layout as positions. */
  normals: Float32Array
  triangleCount: number
  bounds: Bounds
}

export interface LogLine {
  stream: 'stdout' | 'stderr'
  text: string
}

export interface Diagnostic {
  /** 1-based line in main.scad */
  line: number
  severity: 'error' | 'warning'
  /** OpenSCAD's message without the "in file …, line N" clause, e.g. "Parser error: syntax error". */
  message: string
}

interface ResultBase {
  logs: LogLine[]
  diagnostics: Diagnostic[]
  renderMs: number
}

export type RenderResult =
  | (ResultBase & { ok: true; mesh: MeshData; stl: ArrayBuffer })
  | (ResultBase & { ok: false; error: string })
```

- [ ] **Step 2: Write the failing tests**

`src/render/args.test.ts`:

```ts
import { buildArgs, formatParamValue, INPUT_PATH, OUTPUT_PATH } from './args'

describe('buildArgs', () => {
  it('compiles main.scad to binary STL with the manifold backend', () => {
    expect(buildArgs()).toEqual([INPUT_PATH, '-o', OUTPUT_PATH, '--backend=manifold', '--export-format=binstl'])
  })

  it('adds one -D override per parameter', () => {
    const args = buildArgs({ w: 40, holes: true, label: 'A"B', size: [20, 30, 5] })
    expect(args.slice(5)).toEqual(['-D', 'w=40', '-D', 'holes=true', '-D', 'label="A\\"B"', '-D', 'size=[20,30,5]'])
  })

  it('rejects parameter names that are not OpenSCAD identifiers', () => {
    expect(() => buildArgs({ 'a=1;b': 2 })).toThrow('Invalid parameter name: a=1;b')
  })

  it('rejects non-finite numbers', () => {
    expect(() => buildArgs({ w: Number.NaN })).toThrow('must be finite')
    expect(() => buildArgs({ v: [1, Infinity] })).toThrow('must be finite')
  })
})

describe('formatParamValue', () => {
  it('formats each value type as an OpenSCAD literal', () => {
    expect(formatParamValue(0.5)).toBe('0.5')
    expect(formatParamValue(false)).toBe('false')
    expect(formatParamValue('round')).toBe('"round"')
    expect(formatParamValue([1, 2])).toBe('[1,2]')
  })
})
```

`src/render/diagnostics.test.ts`:

```ts
import { parseDiagnosticLine, parseDiagnostics } from './diagnostics'
import type { LogLine } from './types'

const err = (text: string): LogLine => ({ stream: 'stderr', text })

it('maps parser errors in main.scad to a line and strips the location clause', () => {
  expect(parseDiagnostics([err('ERROR: Parser error in file "/main.scad", line 3: syntax error')])).toEqual([
    { severity: 'error', line: 3, message: 'Parser error: syntax error' },
  ])
})

it('maps warnings with an unquoted file name', () => {
  expect(parseDiagnostics([err("WARNING: Ignoring unknown variable 'x' in file main.scad, line 2")])).toEqual([
    { severity: 'warning', line: 2, message: "Ignoring unknown variable 'x'" },
  ])
})

it('ignores lines without a location, other files, and non-diagnostic output', () => {
  expect(
    parseDiagnostics([
      err('ERROR: Current top level object is empty.'),
      err('WARNING: something in file /lib/BOSL2/std.scad, line 9'),
      { stream: 'stdout', text: 'ECHO: 42' },
      err('TRACE: called by module'),
    ]),
  ).toEqual([])
})

it('parses a single line, returning null for anything that is not a located diagnostic', () => {
  expect(parseDiagnosticLine('WARNING: variable w not specified as parameter, in file main.scad, line 12')).toEqual({
    severity: 'warning',
    line: 12,
    message: 'variable w not specified as parameter',
  })
  expect(parseDiagnosticLine('ECHO: "wall = 2"')).toBeNull()
  expect(parseDiagnosticLine('ERROR: Execution aborted')).toBeNull()
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/render`
Expected: FAIL, because `./args` and `./diagnostics` can't be resolved.

- [ ] **Step 4: Implement**

`src/render/args.ts`:

```ts
import type { ParamValue } from './types'

export const INPUT_PATH = '/main.scad'
export const OUTPUT_PATH = '/out.stl'

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_]*$/

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Parameter value must be finite, got ${n}`)
  return String(n)
}

export function formatParamValue(value: ParamValue): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(formatNumber).join(',')}]`
  return formatNumber(value)
}

export function buildArgs(params: Record<string, ParamValue> = {}): string[] {
  const args = [INPUT_PATH, '-o', OUTPUT_PATH, '--backend=manifold', '--export-format=binstl']
  for (const [name, value] of Object.entries(params)) {
    if (!IDENTIFIER.test(name)) throw new Error(`Invalid parameter name: ${name}`)
    args.push('-D', `${name}=${formatParamValue(value)}`)
  }
  return args
}
```

`src/render/diagnostics.ts`:

```ts
import type { Diagnostic, LogLine } from './types'

const PREFIX = /^(ERROR|WARNING):\s*(.*)$/
/** `, in file main.scad, line 12` or ` in file "/main.scad", line 3` */
const LOCATION = /,?\s*in file\s+"?([^",]+?)"?,\s*line\s+(\d+)/

export function parseDiagnosticLine(text: string): Diagnostic | null {
  const m = PREFIX.exec(text.trim())
  if (!m) return null
  const loc = LOCATION.exec(m[2])
  if (!loc || !/(^|\/)main\.scad$/.test(loc[1])) return null
  const message = m[2].replace(LOCATION, '').replace(/\s{2,}/g, ' ').trim()
  return { severity: m[1] === 'ERROR' ? 'error' : 'warning', line: Number(loc[2]), message }
}

export function parseDiagnostics(logs: LogLine[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const { text } of logs) {
    const d = parseDiagnosticLine(text)
    if (d) out.push(d)
  }
  return out
}
```

`src/render/result.ts`:

```ts
import { parseDiagnostics } from './diagnostics'
import type { LogLine, RenderResult } from './types'

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function failedResult(
  error: string,
  { logs = [], renderMs = 0 }: { logs?: LogLine[]; renderMs?: number } = {},
): RenderResult {
  return { ok: false, error, logs, diagnostics: parseDiagnostics(logs), renderMs }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/render && npm run typecheck`
Expected: PASS (9 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/render
git commit -m "feat(render): request/result types, OpenSCAD args and diagnostics parser"
```

---

### Task 5: STL parsing and dimensions

**Files:**
- Create: `src/render/stl.ts`, `src/render/dims.ts`, `src/test/stl.ts`
- Test: `src/render/stl.test.ts`, `src/render/dims.test.ts`

**Interfaces:**
- Consumes: `MeshData`, `Bounds`, `Vec3` from `src/render/types.ts`.
- Produces:
  - `parseStl(buffer: ArrayBuffer): MeshData`, which accepts binary and ASCII STL and throws `'Unrecognised STL data'` / `'Malformed ASCII STL'`
  - `formatDimParts(bounds: Bounds): [string, string, string]`, each side rounded to two decimals with trailing zeros dropped (for the axis form "X 20 Y 20 Z 10 mm")
  - `formatDims(bounds: Bounds): string`, for example `"20 × 20 × 10 mm"` (DimsReadout: "Round to two decimals and drop trailing zeros")
  - Test helpers: `type Tri = [Vec3, Vec3, Vec3]`, `binaryStl(tris: Tri[]): ArrayBuffer`, `asciiStl(tris: Tri[]): string`, `BOX_TRI: Tri` (bounds 20×20×10)

- [ ] **Step 1: Write test helpers**

`src/test/stl.ts`:

```ts
import type { Vec3 } from '../render/types'

export type Tri = [Vec3, Vec3, Vec3]

/** One triangle whose bounding box is 20 × 20 × 10 mm. */
export const BOX_TRI: Tri = [
  [0, 0, 0],
  [20, 20, 0],
  [0, 0, 10],
]

export function binaryStl(tris: Tri[]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + tris.length * 50)
  const view = new DataView(buf)
  new Uint8Array(buf).set(new TextEncoder().encode('solid binary header that starts with solid'))
  view.setUint32(80, tris.length, true)
  tris.forEach((tri, t) =>
    tri.forEach((p, i) => p.forEach((c, k) => view.setFloat32(84 + t * 50 + 12 + (i * 3 + k) * 4, c, true))),
  )
  return buf
}

export function asciiStl(tris: Tri[]): string {
  const facets = tris
    .map(
      (tri) =>
        `  facet normal 0 0 0\n    outer loop\n${tri.map((p) => `      vertex ${p.join(' ')}`).join('\n')}\n    endloop\n  endfacet`,
    )
    .join('\n')
  return `solid model\n${facets}\nendsolid model\n`
}
```

- [ ] **Step 2: Write the failing tests**

`src/render/stl.test.ts`:

```ts
import { asciiStl, binaryStl, BOX_TRI, type Tri } from '../test/stl'
import { parseStl } from './stl'

const FLAT: Tri = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
]

it('parses binary STL even when the header starts with "solid"', () => {
  const mesh = parseStl(binaryStl([FLAT, BOX_TRI]))
  expect(mesh.triangleCount).toBe(2)
  expect(Array.from(mesh.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
})

it('parses ASCII STL', () => {
  const mesh = parseStl(new TextEncoder().encode(asciiStl([FLAT])).buffer)
  expect(mesh.triangleCount).toBe(1)
  expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
})

it('computes flat unit normals from the vertices', () => {
  const mesh = parseStl(binaryStl([FLAT]))
  expect(Array.from(mesh.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1])
})

it('computes bounds', () => {
  expect(parseStl(binaryStl([BOX_TRI])).bounds).toEqual({ min: [0, 0, 0], max: [20, 20, 10] })
})

it('returns an empty mesh with zero bounds for zero triangles', () => {
  const mesh = parseStl(binaryStl([]))
  expect(mesh.triangleCount).toBe(0)
  expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
})

it('rejects data that is neither binary nor ASCII STL', () => {
  expect(() => parseStl(new TextEncoder().encode('hello').buffer)).toThrow('Unrecognised STL data')
})

it('rejects ASCII STL with a partial triangle', () => {
  const broken = 'solid x\n vertex 0 0 0\n vertex 1 0 0\nendsolid x'
  expect(() => parseStl(new TextEncoder().encode(broken).buffer)).toThrow('Malformed ASCII STL')
})
```

`src/render/dims.test.ts`:

```ts
import { formatDimParts, formatDims } from './dims'

it('formats bounding box size in mm with the multiplication sign', () => {
  expect(formatDims({ min: [0, 0, 0], max: [20, 20, 10] })).toBe('20 × 20 × 10 mm')
})

it('rounds to two decimals and trims zeros', () => {
  expect(formatDims({ min: [-1, 0, 0], max: [1.5, 0.333333, 2] })).toBe('2.5 × 0.33 × 2 mm')
})

it('exposes the three sides separately for the axis readout', () => {
  expect(formatDimParts({ min: [0, 0, 0], max: [88.8, 25.4, 22] })).toEqual(['88.8', '25.4', '22'])
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/render/stl.test.ts src/render/dims.test.ts`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 4: Implement**

`src/render/stl.ts`:

```ts
import type { MeshData, Vec3 } from './types'

export function parseStl(buffer: ArrayBuffer): MeshData {
  if (buffer.byteLength >= 84) {
    const view = new DataView(buffer)
    const count = view.getUint32(80, true)
    if (84 + count * 50 === buffer.byteLength) return parseBinary(view, count)
  }
  const text = new TextDecoder().decode(buffer)
  if (/^\s*solid/.test(text)) return parseAscii(text)
  throw new Error('Unrecognised STL data')
}

function parseBinary(view: DataView, count: number): MeshData {
  const positions = new Float32Array(count * 9)
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(base + k * 4, true)
  }
  return finalize(positions)
}

function parseAscii(text: string): MeshData {
  const nums: number[] = []
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) nums.push(Number(m[1]), Number(m[2]), Number(m[3]))
  if (nums.length % 9 !== 0 || nums.some((n) => !Number.isFinite(n))) throw new Error('Malformed ASCII STL')
  return finalize(new Float32Array(nums))
}

function finalize(positions: Float32Array): MeshData {
  const triangleCount = positions.length / 9
  const normals = new Float32Array(positions.length)
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]

  for (let o = 0; o < positions.length; o += 9) {
    const ax = positions[o + 3] - positions[o], ay = positions[o + 4] - positions[o + 1], az = positions[o + 5] - positions[o + 2]
    const bx = positions[o + 6] - positions[o], by = positions[o + 7] - positions[o + 1], bz = positions[o + 8] - positions[o + 2]
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    for (let v = 0; v < 3; v++) {
      normals[o + v * 3] = nx
      normals[o + v * 3 + 1] = ny
      normals[o + v * 3 + 2] = nz
    }
  }

  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const p = positions[i + a]
      if (p < min[a]) min[a] = p
      if (p > max[a]) max[a] = p
    }
  }

  const bounds = triangleCount > 0 ? { min, max } : { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 }
  return { positions, normals, triangleCount, bounds }
}
```

`src/render/dims.ts`:

```ts
import type { Bounds } from './types'

const fmt = (n: number) => String(Number(n.toFixed(2)))

export function formatDimParts({ min, max }: Bounds): [string, string, string] {
  return [fmt(max[0] - min[0]), fmt(max[1] - min[1]), fmt(max[2] - min[2])]
}

export function formatDims(bounds: Bounds): string {
  return `${formatDimParts(bounds).join(' × ')} mm`
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/render && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/render src/test/stl.ts
git commit -m "feat(render): binary/ASCII STL parser with flat normals, bounds and mm dims"
```

---

### Task 6: One OpenSCAD compile (`runOpenSCAD`) and the Comlink worker

**Files:**
- Create: `src/render/runOpenSCAD.ts`, `src/render/render.worker.ts`, `src/render/createRenderWorker.ts`
- Test: `src/render/runOpenSCAD.test.ts`

**Interfaces:**
- Consumes: `buildArgs`, `INPUT_PATH`, `OUTPUT_PATH` (Task 4); `parseStl` (Task 5); `failedResult`, `errorMessage` (Task 4); `parseDiagnostics` (Task 4); `binaryStl`, `BOX_TRI` (test helpers, Task 5).
- Produces:
  - `interface OpenSCADInstance { FS: { writeFile(path: string, data: string | Uint8Array): void; readFile(path: string): Uint8Array }; callMain(args: string[]): number }`
  - `interface OpenSCADFactoryOptions { noInitialRun: true; print(text: string): void; printErr(text: string): void; locateFile?(path: string): string }`
  - `type OpenSCADFactory = (opts: OpenSCADFactoryOptions) => Promise<OpenSCADInstance>`
  - `runOpenSCAD(factory: OpenSCADFactory, req: RenderRequest): Promise<RenderResult>`, which never throws
  - `type RenderWorkerApi = { render(req: RenderRequest): Promise<RenderResult> }` (from `render.worker.ts`)
  - `interface RenderWorkerHandle { render(req: RenderRequest): Promise<RenderResult>; terminate(): void }` and `type WorkerFactory = () => RenderWorkerHandle`, both in `createRenderWorker.ts`
  - `createRenderWorker(): RenderWorkerHandle`

- [ ] **Step 1: Write the failing tests**

`src/render/runOpenSCAD.test.ts`:

```ts
import { binaryStl, BOX_TRI } from '../test/stl'
import { INPUT_PATH, OUTPUT_PATH } from './args'
import { runOpenSCAD, type OpenSCADFactory, type OpenSCADFactoryOptions, type OpenSCADInstance } from './runOpenSCAD'

type FakeInstance = OpenSCADInstance & { files: Map<string, Uint8Array | string>; opts: OpenSCADFactoryOptions }

function fakeFactory(behaviour: (inst: FakeInstance, args: string[]) => number) {
  const created: FakeInstance[] = []
  const factory: OpenSCADFactory = async (opts) => {
    const files = new Map<string, Uint8Array | string>()
    const inst: FakeInstance = {
      files,
      opts,
      FS: {
        writeFile: (path, data) => void files.set(path, data),
        readFile: (path) => {
          const f = files.get(path)
          if (f === undefined) throw new Error(`ENOENT ${path}`)
          return typeof f === 'string' ? new TextEncoder().encode(f) : f
        },
      },
      callMain: (args) => behaviour(inst, args),
    }
    created.push(inst)
    return inst
  }
  return { factory, created }
}

const writesBox = (inst: FakeInstance) => {
  inst.files.set(OUTPUT_PATH, new Uint8Array(binaryStl([BOX_TRI])))
  return 0
}

it('writes the code, passes -D overrides, and returns the parsed mesh and STL', async () => {
  let seenArgs: string[] = []
  const { factory, created } = fakeFactory((inst, args) => {
    seenArgs = args
    inst.opts.print('ECHO: 42')
    return writesBox(inst)
  })

  const result = await runOpenSCAD(factory, { code: 'cube(20);', params: { w: 5 } })

  expect(created[0].files.get(INPUT_PATH)).toBe('cube(20);')
  expect(seenArgs).toContain('w=5')
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.mesh.triangleCount).toBe(1)
  expect(result.mesh.bounds.max).toEqual([20, 20, 10])
  expect(result.stl.byteLength).toBe(134)
  expect(result.logs).toEqual([{ stream: 'stdout', text: 'ECHO: 42' }])
})

it('reports a compile error with diagnostics when OpenSCAD exits non-zero', async () => {
  const { factory } = fakeFactory((inst) => {
    inst.opts.printErr('ERROR: Parser error in file "/main.scad", line 3: syntax error')
    return 1
  })
  const result = await runOpenSCAD(factory, { code: 'cube(' })
  expect(result).toMatchObject({ ok: false, error: 'OpenSCAD exited with code 1' })
  expect(result.diagnostics).toEqual([expect.objectContaining({ line: 3, severity: 'error' })])
})

it('treats a thrown Emscripten ExitStatus as an exit code', async () => {
  const { factory } = fakeFactory(() => {
    throw { name: 'ExitStatus', status: 1 }
  })
  expect(await runOpenSCAD(factory, { code: 'x' })).toMatchObject({ ok: false, error: 'OpenSCAD exited with code 1' })
})

it('reports a crash when callMain throws an Error', async () => {
  const { factory } = fakeFactory(() => {
    throw new Error('memory access out of bounds')
  })
  expect(await runOpenSCAD(factory, { code: 'x' })).toMatchObject({
    ok: false,
    error: 'OpenSCAD crashed: memory access out of bounds',
  })
})

it('reports no output when the model produces nothing (empty file, only echo)', async () => {
  const { factory } = fakeFactory(() => 0)
  expect(await runOpenSCAD(factory, { code: 'echo("hi");' })).toMatchObject({
    ok: false,
    error: 'OpenSCAD produced no output (is the model empty?)',
  })
})

it('reports an empty model when the STL has zero triangles', async () => {
  const { factory } = fakeFactory((inst) => {
    inst.files.set(OUTPUT_PATH, new Uint8Array(binaryStl([])))
    return 0
  })
  expect(await runOpenSCAD(factory, { code: '' })).toMatchObject({ ok: false, error: 'Model is empty' })
})

it('reports invalid parameters without loading OpenSCAD', async () => {
  const { factory, created } = fakeFactory(writesBox)
  const result = await runOpenSCAD(factory, { code: 'cube(1);', params: { 'bad name': 1 } })
  expect(result).toMatchObject({ ok: false, error: 'Invalid parameter name: bad name' })
  expect(created).toHaveLength(0)
})

it('reports a load failure when the factory rejects', async () => {
  const factory: OpenSCADFactory = () => Promise.reject(new Error('wasm 404'))
  expect(await runOpenSCAD(factory, { code: 'cube(1);' })).toMatchObject({
    ok: false,
    error: 'Failed to load OpenSCAD: wasm 404',
  })
})

it('uses a fresh instance for every render', async () => {
  const { factory, created } = fakeFactory(writesBox)
  await runOpenSCAD(factory, { code: 'cube(1);' })
  await runOpenSCAD(factory, { code: 'cube(2);' })
  expect(created).toHaveLength(2)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/runOpenSCAD.test.ts`
Expected: FAIL, because `./runOpenSCAD` can't be resolved.

- [ ] **Step 3: Implement `runOpenSCAD`**

`src/render/runOpenSCAD.ts`:

```ts
import { buildArgs, INPUT_PATH, OUTPUT_PATH } from './args'
import { parseDiagnostics } from './diagnostics'
import { errorMessage, failedResult } from './result'
import { parseStl } from './stl'
import type { LogLine, MeshData, RenderRequest, RenderResult } from './types'

export interface OpenSCADInstance {
  FS: {
    writeFile(path: string, data: string | Uint8Array): void
    readFile(path: string): Uint8Array
  }
  callMain(args: string[]): number
}

export interface OpenSCADFactoryOptions {
  noInitialRun: true
  print(text: string): void
  printErr(text: string): void
  locateFile?(path: string): string
}

export type OpenSCADFactory = (opts: OpenSCADFactoryOptions) => Promise<OpenSCADInstance>

function isExitStatus(e: unknown): e is { status: number } {
  return typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number'
}

export async function runOpenSCAD(factory: OpenSCADFactory, req: RenderRequest): Promise<RenderResult> {
  const startedAt = performance.now()
  const logs: LogLine[] = []
  const fail = (error: string) => failedResult(error, { logs, renderMs: performance.now() - startedAt })

  let args: string[]
  try {
    args = buildArgs(req.params)
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

  let exitCode: number
  try {
    exitCode = instance.callMain(args)
  } catch (e) {
    if (!isExitStatus(e)) return fail(`OpenSCAD crashed: ${errorMessage(e)}`)
    exitCode = e.status
  }
  if (exitCode !== 0) return fail(`OpenSCAD exited with code ${exitCode}`)

  let bytes: Uint8Array
  try {
    bytes = instance.FS.readFile(OUTPUT_PATH)
  } catch {
    return fail('OpenSCAD produced no output (is the model empty?)')
  }

  const stl = new Uint8Array(bytes).buffer
  let mesh: MeshData
  try {
    mesh = parseStl(stl)
  } catch (e) {
    return fail(errorMessage(e))
  }
  if (mesh.triangleCount === 0) return fail('Model is empty')

  return { ok: true, mesh, stl, logs, diagnostics: parseDiagnostics(logs), renderMs: performance.now() - startedAt }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render/runOpenSCAD.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the worker and the real worker factory**

```bash
npm i comlink
```

`src/render/render.worker.ts`. This file is thin glue and is exercised by the Playwright test in Task 13:

```ts
import * as Comlink from 'comlink'
import { runOpenSCAD, type OpenSCADFactory, type OpenSCADFactoryOptions } from './runOpenSCAD'
import type { RenderRequest, RenderResult } from './types'

const OPENSCAD_DIR = `${import.meta.env.BASE_URL}openscad/`

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

const api = {
  async render(req: RenderRequest): Promise<RenderResult> {
    const result = await runOpenSCAD(await loadFactory(), req)
    if (!result.ok) return result
    return Comlink.transfer(result, [result.mesh.positions.buffer, result.mesh.normals.buffer, result.stl])
  },
}

export type RenderWorkerApi = typeof api

Comlink.expose(api)
```

`src/render/createRenderWorker.ts`:

```ts
import * as Comlink from 'comlink'
import type { RenderWorkerApi } from './render.worker'
import type { RenderRequest, RenderResult } from './types'

export interface RenderWorkerHandle {
  render(req: RenderRequest): Promise<RenderResult>
  terminate(): void
}

export type WorkerFactory = () => RenderWorkerHandle

export function createRenderWorker(): RenderWorkerHandle {
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
  const api = Comlink.wrap<RenderWorkerApi>(worker)
  return {
    render: (req) => api.render(req),
    terminate: () => {
      api[Comlink.releaseProxy]()
      worker.terminate()
    },
  }
}
```

- [ ] **Step 6: Typecheck and run all tests**

Run: `npm run typecheck && npm test`
Expected: no type errors, and all tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/render
git commit -m "feat(render): runOpenSCAD with fresh WASM instance per render, Comlink worker"
```

---

### Task 7: RenderController (debounce, cancel, timeout, respawn)

**Files:**
- Create: `src/render/controller.ts`, `src/test/results.ts`
- Test: `src/render/controller.test.ts`

**Interfaces:**
- Consumes: `RenderWorkerHandle`, `WorkerFactory` (Task 6); `failedResult`, `errorMessage` (Task 4); `parseStl` (Task 5); `binaryStl`, `BOX_TRI` (Task 5 test helpers).
- Produces:
  - `DEFAULT_DEBOUNCE_MS = 600`, `DEFAULT_TIMEOUT_MS = 60_000`
  - `interface RenderControllerOptions { createWorker: WorkerFactory; onResult(result: RenderResult): void; onStart?(): void; debounceMs?: number; timeoutMs?: number }`
  - `class RenderController { constructor(opts: RenderControllerOptions); request(req: RenderRequest, opts?: { immediate?: boolean }): void; cancel(): void; dispose(): void }`
  - The timeout error string is exactly `Render timed out after 60 s` (the StatusPill in Task 10 derives "Timed out after 60 s" from it)
  - Test helpers `okResult(): RenderResult` (the 20×20×10 mesh) and `errorResult(message?: string): RenderResult`

- [ ] **Step 1: Write the shared result fixtures**

`src/test/results.ts`:

```ts
import { failedResult } from '../render/result'
import { parseStl } from '../render/stl'
import type { RenderResult } from '../render/types'
import { binaryStl, BOX_TRI } from './stl'

export function okResult(): RenderResult {
  const stl = binaryStl([BOX_TRI])
  return { ok: true, mesh: parseStl(stl), stl, logs: [], diagnostics: [], renderMs: 12 }
}

export function errorResult(message = 'OpenSCAD exited with code 1'): RenderResult {
  return failedResult(message, {
    logs: [{ stream: 'stderr', text: 'ERROR: Parser error in file "/main.scad", line 1: syntax error' }],
    renderMs: 5,
  })
}
```

- [ ] **Step 2: Write the failing tests**

`src/render/controller.test.ts`:

```ts
import type { Mock } from 'vitest'
import { okResult } from '../test/results'
import { RenderController } from './controller'
import type { RenderRequest, RenderResult } from './types'

interface Deferred<T> {
  promise: Promise<T>
  resolve(v: T): void
  reject(e: unknown): void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface FakeWorker {
  requests: RenderRequest[]
  pending: Deferred<RenderResult>[]
  render: Mock<(req: RenderRequest) => Promise<RenderResult>>
  terminate: Mock<() => void>
}

function fakeWorkers() {
  const workers: FakeWorker[] = []
  const createWorker = vi.fn(() => {
    const w: FakeWorker = {
      requests: [],
      pending: [],
      render: vi.fn((req: RenderRequest) => {
        w.requests.push(req)
        const d = deferred<RenderResult>()
        w.pending.push(d)
        return d.promise
      }),
      terminate: vi.fn(),
    }
    workers.push(w)
    return w
  })
  return { workers, createWorker }
}

function setup(timeoutMs = 60_000) {
  const { workers, createWorker } = fakeWorkers()
  const onResult = vi.fn()
  const onStart = vi.fn()
  const controller = new RenderController({ createWorker, onResult, onStart, debounceMs: 600, timeoutMs })
  return { workers, createWorker, onResult, onStart, controller }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('debounces requests and renders only the latest code', async () => {
  const { workers, controller, onStart } = setup()
  controller.request({ code: 'a' })
  await vi.advanceTimersByTimeAsync(300)
  controller.request({ code: 'ab' })
  await vi.advanceTimersByTimeAsync(599)
  expect(workers).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(workers[0].requests).toEqual([{ code: 'ab' }])
  expect(onStart).toHaveBeenCalledTimes(1)
})

it('renders immediately when asked', async () => {
  const { workers, controller } = setup()
  controller.request({ code: 'a' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(workers[0].requests).toEqual([{ code: 'a' }])
})

it('delivers the result and reuses the worker for the next render', async () => {
  const { workers, controller, onResult, createWorker } = setup()
  controller.request({ code: 'a' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  const result = okResult()
  workers[0].pending[0].resolve(result)
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenCalledWith(result)

  controller.request({ code: 'b' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(createWorker).toHaveBeenCalledTimes(1)
  expect(workers[0].requests[1]).toEqual({ code: 'b' })
})

it('cancels the in-flight render when a newer one starts, and drops the stale result', async () => {
  const { workers, controller, onResult } = setup()
  controller.request({ code: 'old' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  controller.request({ code: 'new' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)

  expect(workers[0].terminate).toHaveBeenCalled()
  expect(workers[1].requests).toEqual([{ code: 'new' }])

  workers[0].pending[0].resolve(okResult())
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).not.toHaveBeenCalled()

  const fresh = okResult()
  workers[1].pending[0].resolve(fresh)
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenCalledExactlyOnceWith(fresh)
})

it('times out a hung render, kills the worker, and ignores its late result', async () => {
  const { workers, controller, onResult } = setup(60_000)
  controller.request({ code: 'for(i=[0:1e9]) cube(1);' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(59_999)
  expect(onResult).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)

  expect(workers[0].terminate).toHaveBeenCalled()
  expect(onResult).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ ok: false, error: 'Render timed out after 60 s' }),
  )

  workers[0].pending[0].resolve(okResult())
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenCalledTimes(1)
})

it('spawns a new worker for the next render after a timeout', async () => {
  const { workers, controller, onResult } = setup(1_000)
  controller.request({ code: 'hang' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(1_000)
  controller.request({ code: 'cube(1);' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(workers).toHaveLength(2)
  const result = okResult()
  workers[1].pending[0].resolve(result)
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenLastCalledWith(result)
})

it('reports a worker crash and replaces the worker', async () => {
  const { workers, controller, onResult } = setup()
  controller.request({ code: 'a' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  workers[0].pending[0].reject(new Error('worker died'))
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'Render worker crashed: worker died' }))
  expect(workers[0].terminate).toHaveBeenCalled()

  controller.request({ code: 'b' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(workers).toHaveLength(2)
})

it('dispose cancels pending debounce and terminates the worker', async () => {
  const { workers, controller } = setup()
  controller.request({ code: 'a' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  controller.request({ code: 'b' })
  controller.dispose()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(workers[0].terminate).toHaveBeenCalled()
  expect(workers[0].requests).toEqual([{ code: 'a' }])
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/render/controller.test.ts`
Expected: FAIL, because `./controller` can't be resolved.

- [ ] **Step 4: Implement**

`src/render/controller.ts`:

```ts
import type { RenderWorkerHandle, WorkerFactory } from './createRenderWorker'
import { errorMessage, failedResult } from './result'
import type { RenderRequest, RenderResult } from './types'

export const DEFAULT_DEBOUNCE_MS = 600
export const DEFAULT_TIMEOUT_MS = 60_000

export interface RenderControllerOptions {
  createWorker: WorkerFactory
  onResult(result: RenderResult): void
  onStart?(): void
  debounceMs?: number
  timeoutMs?: number
}

export class RenderController {
  private readonly createWorker: WorkerFactory
  private readonly onResult: (result: RenderResult) => void
  private readonly onStart: () => void
  private readonly debounceMs: number
  private readonly timeoutMs: number

  private worker: RenderWorkerHandle | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private currentId = 0
  private inFlight = false

  constructor(opts: RenderControllerOptions) {
    this.createWorker = opts.createWorker
    this.onResult = opts.onResult
    this.onStart = opts.onStart ?? (() => {})
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  request(req: RenderRequest, { immediate = false }: { immediate?: boolean } = {}): void {
    this.clearDebounce()
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = null
        this.start(req)
      },
      immediate ? 0 : this.debounceMs,
    )
  }

  cancel(): void {
    this.clearDebounce()
    if (this.inFlight) this.killWorker()
    this.settle()
    this.currentId++
  }

  dispose(): void {
    this.cancel()
    this.killWorker()
  }

  private start(req: RenderRequest): void {
    if (this.inFlight) this.killWorker()
    this.settle()
    const id = ++this.currentId
    this.inFlight = true
    this.onStart()

    const worker = (this.worker ??= this.createWorker())
    const startedAt = performance.now()
    let done = false
    const deliver = (result: RenderResult, kill: boolean) => {
      if (done || id !== this.currentId) return
      done = true
      this.settle()
      if (kill) this.killWorker()
      this.onResult(result)
    }

    this.timeoutTimer = setTimeout(
      () => deliver(failedResult(`Render timed out after ${Math.round(this.timeoutMs / 1000)} s`, { renderMs: this.timeoutMs }), true),
      this.timeoutMs,
    )
    worker.render(req).then(
      (result) => deliver(result, false),
      (err: unknown) =>
        deliver(failedResult(`Render worker crashed: ${errorMessage(err)}`, { renderMs: performance.now() - startedAt }), true),
    )
  }

  private settle(): void {
    this.inFlight = false
    if (this.timeoutTimer !== null) clearTimeout(this.timeoutTimer)
    this.timeoutTimer = null
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
  }

  private killWorker(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/render/controller.test.ts && npm run typecheck`
Expected: PASS (8 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/render/controller.ts src/render/controller.test.ts src/test/results.ts
git commit -m "feat(render): RenderController with debounce, cancel-on-newer, 60 s timeout and respawn"
```

---

### Task 8: App store and render loop hook

**Files:**
- Create: `src/state/store.ts`, `src/render/useRenderLoop.ts`
- Test: `src/state/store.test.ts`, `src/render/useRenderLoop.test.ts`

**Interfaces:**
- Consumes: `RenderController`, `DEFAULT_DEBOUNCE_MS`, `DEFAULT_TIMEOUT_MS` (Task 7); `WorkerFactory`, `createRenderWorker` (Task 6); `okResult`, `errorResult` (Task 7 helpers).
- Produces:
  - `type RenderStatus = 'idle' | 'rendering' | 'ok' | 'error'`
  - `interface RevealRequest { line: number; id: number }` (a fresh `id` per request so the editor reacts even when the same line is asked for twice)
  - `interface AppState { code; status; mesh: MeshData | null; stl: ArrayBuffer | null; logs; diagnostics; error: string | null; renderMs: number | null; reveal: RevealRequest | null; setCode(code: string): void; renderStarted(): void; renderFinished(result: RenderResult): void; goToLine(line: number): void }`
  - `useAppStore` (Zustand hook; also `.getState()`, `.setState()`, `.subscribe()`, `.getInitialState()`)
  - `DEFAULT_CODE: string` (renders to 20 × 20 × 10 mm, with Customizer-style comments as the design system's example code does)
  - `selectCanExport(state: AppState): boolean`
  - `useRenderLoop(createWorker?: WorkerFactory, debounceMs?: number, timeoutMs?: number): void`

- [ ] **Step 1: Write the failing tests**

```bash
npm i zustand
```

`src/state/store.test.ts`:

```ts
import { errorResult, okResult } from '../test/results'
import { DEFAULT_CODE, selectCanExport, useAppStore } from './store'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('starts idle with the default model code', () => {
  const s = useAppStore.getState()
  expect(s.code).toBe(DEFAULT_CODE)
  expect(s.status).toBe('idle')
  expect(s.mesh).toBeNull()
  expect(s.reveal).toBeNull()
})

it('stores mesh, STL, logs and timing on success', () => {
  const result = okResult()
  useAppStore.getState().renderStarted()
  expect(useAppStore.getState().status).toBe('rendering')
  useAppStore.getState().renderFinished(result)
  const s = useAppStore.getState()
  expect(s.status).toBe('ok')
  expect(s.mesh).toBe(result.ok && result.mesh)
  expect(s.stl).toBe(result.ok && result.stl)
  expect(s.renderMs).toBe(12)
  expect(s.error).toBeNull()
})

it('keeps the last good mesh when a render fails', () => {
  const good = okResult()
  useAppStore.getState().renderFinished(good)
  useAppStore.getState().renderFinished(errorResult())
  const s = useAppStore.getState()
  expect(s.status).toBe('error')
  expect(s.error).toBe('OpenSCAD exited with code 1')
  expect(s.mesh).toBe(good.ok && good.mesh)
  expect(s.diagnostics).toEqual([expect.objectContaining({ line: 1 })])
})

it('clears the error after the next successful render', () => {
  useAppStore.getState().renderFinished(errorResult())
  useAppStore.getState().renderFinished(okResult())
  expect(useAppStore.getState().error).toBeNull()
})

it('issues a new reveal request each time a line is asked for, even the same line', () => {
  useAppStore.getState().goToLine(7)
  const first = useAppStore.getState().reveal
  useAppStore.getState().goToLine(7)
  const second = useAppStore.getState().reveal
  expect(first).toEqual({ line: 7, id: expect.any(Number) })
  expect(second?.line).toBe(7)
  expect(second?.id).not.toBe(first?.id)
})

describe('selectCanExport', () => {
  it('is false before any render', () => {
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
  it('is true after a successful render', () => {
    useAppStore.getState().renderFinished(okResult())
    expect(selectCanExport(useAppStore.getState())).toBe(true)
  })
  it('is false while re-rendering, so the export never mismatches the code', () => {
    useAppStore.getState().renderFinished(okResult())
    useAppStore.getState().renderStarted()
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
  it('is false when the current code failed, even with an older mesh on screen', () => {
    useAppStore.getState().renderFinished(okResult())
    useAppStore.getState().renderFinished(errorResult())
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
})
```

`src/render/useRenderLoop.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { DEFAULT_CODE, useAppStore } from '../state/store'
import { okResult } from '../test/results'
import type { RenderWorkerHandle } from './createRenderWorker'
import type { RenderRequest } from './types'
import { useRenderLoop } from './useRenderLoop'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

function instantWorker() {
  const requests: RenderRequest[] = []
  const handle: RenderWorkerHandle = {
    render: async (req) => {
      requests.push(req)
      return okResult()
    },
    terminate: vi.fn(),
  }
  return { requests, createWorker: () => handle, handle }
}

it('renders the initial code immediately, then re-renders after debounced edits', async () => {
  const { requests, createWorker } = instantWorker()
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))

  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(requests).toEqual([{ code: DEFAULT_CODE }])
  expect(useAppStore.getState().status).toBe('ok')

  act(() => useAppStore.getState().setCode('cube(1);'))
  await act(() => vi.advanceTimersByTimeAsync(599))
  expect(requests).toHaveLength(1)
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(requests[1]).toEqual({ code: 'cube(1);' })
})

it('terminates the worker on unmount', async () => {
  const { createWorker, handle } = instantWorker()
  const { unmount } = renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(0))
  unmount()
  expect(handle.terminate).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state src/render/useRenderLoop.test.ts`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 3: Implement**

`src/state/store.ts`:

```ts
import { create } from 'zustand'
import type { Diagnostic, LogLine, MeshData, RenderResult } from '../render/types'

export type RenderStatus = 'idle' | 'rendering' | 'ok' | 'error'

export interface RevealRequest {
  line: number
  id: number
}

export const DEFAULT_CODE = `// PromptCAD: edit me
/* [Dimensions] */
width = 20;  // [5:1:100]
depth = 20;  // [5:1:100]
height = 10; // [2:1:50]

difference() {
  cube([width, depth, height]);
  translate([width / 2, depth / 2, 2])
    cylinder(h = height, r = min(width, depth) / 4, $fn = 48);
}
`

export interface AppState {
  code: string
  status: RenderStatus
  /** Last successfully rendered mesh; kept on screen when a later render fails. */
  mesh: MeshData | null
  /** Binary STL matching `mesh`. */
  stl: ArrayBuffer | null
  logs: LogLine[]
  diagnostics: Diagnostic[]
  error: string | null
  renderMs: number | null
  /** Asks the editor to scroll to and select a line (status pill and console clicks). */
  reveal: RevealRequest | null
  setCode(code: string): void
  renderStarted(): void
  renderFinished(result: RenderResult): void
  goToLine(line: number): void
}

let revealId = 0

export const useAppStore = create<AppState>()((set) => ({
  code: DEFAULT_CODE,
  status: 'idle',
  mesh: null,
  stl: null,
  logs: [],
  diagnostics: [],
  error: null,
  renderMs: null,
  reveal: null,
  setCode: (code) => set({ code }),
  renderStarted: () => set({ status: 'rendering' }),
  renderFinished: (r) =>
    set(
      r.ok
        ? { status: 'ok', mesh: r.mesh, stl: r.stl, error: null, logs: r.logs, diagnostics: r.diagnostics, renderMs: r.renderMs }
        : { status: 'error', error: r.error, logs: r.logs, diagnostics: r.diagnostics, renderMs: r.renderMs },
    ),
  goToLine: (line) => set({ reveal: { line, id: ++revealId } }),
}))

export const selectCanExport = (s: AppState): boolean => s.status === 'ok' && s.stl !== null
```

`src/render/useRenderLoop.ts`:

```ts
import { useEffect } from 'react'
import { useAppStore } from '../state/store'
import { DEFAULT_DEBOUNCE_MS, DEFAULT_TIMEOUT_MS, RenderController } from './controller'
import { createRenderWorker, type WorkerFactory } from './createRenderWorker'

export function useRenderLoop(
  createWorker: WorkerFactory = createRenderWorker,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): void {
  useEffect(() => {
    const { renderStarted, renderFinished } = useAppStore.getState()
    const controller = new RenderController({
      createWorker,
      debounceMs,
      timeoutMs,
      onStart: renderStarted,
      onResult: renderFinished,
    })
    controller.request({ code: useAppStore.getState().code }, { immediate: true })
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.code !== prev.code) controller.request({ code: state.code })
    })
    return () => {
      unsubscribe()
      controller.dispose()
    }
  }, [createWorker, debounceMs, timeoutMs])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state src/render && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/state src/render/useRenderLoop.ts src/render/useRenderLoop.test.ts
git commit -m "feat(state): Zustand app store, export guard, go-to-line request, render loop hook"
```

---

### Task 9: CodeMirror editor with token theme, OpenSCAD highlighting, inline diagnostics and go-to-line

**Files:**
- Create: `src/editor/openscadLanguage.ts`, `src/editor/theme.ts`, `src/editor/diagnosticsExtension.ts`, `src/editor/CodeEditor.tsx`
- Test: `src/editor/openscadLanguage.test.ts`, `src/editor/diagnosticsExtension.test.ts`, `src/editor/CodeEditor.test.tsx`

**Interfaces:**
- Consumes: `Diagnostic` (Task 4); `RevealRequest` (Task 8); CSS variables `--inset`, `--ink`, `--ink-muted`, `--accent-soft`, `--line`, `--line-strong`, `--panel-raised`, `--shadow-pop`, `--error`, `--error-soft`, `--warn`, `--warn-soft`, `--syn-*`, `--font-mono`, `--font-sans`, `--space-*` (Task 2).
- Produces:
  - `openscadParser: StreamParser<{ inComment: boolean }>` and `openscad(): StreamLanguage<…>`
  - `tokenTheme: Extension` (editor chrome + `openscadHighlight: HighlightStyle` from the `syn-*` tokens)
  - `setAppDiagnostics: StateEffectType<readonly Diagnostic[]>`, `diagnosticsExtension: Extension`, `diagnosticsByLine(doc: Text, diagnostics: readonly Diagnostic[]): Diagnostic[]`, `calloutHeadline(d: Diagnostic): string` (`"Line 7: Parser error: syntax error"`)
  - `toCmDiagnostics(doc: Text, diagnostics: Diagnostic[]): CmDiagnostic[]`, which clamps out-of-range lines into the document
  - `<CodeEditor value={string} onChange={(code: string) => void} diagnostics={Diagnostic[]} reveal?={RevealRequest | null} />`, which renders `data-testid="code-editor"`

The Compile error screen shows three things on a failing line: the whole line on an `error-soft` ground, its line number in `error`, and a `pc-callout is-error` block directly under it with the headline "Line 16: …". `@codemirror/lint` keeps the wavy underline and hover tooltip; the rest is a small extension of our own. The callout is built with `textContent` only, because the message comes from model output.

This uses a hand-written grammar for now. The spec's open question about reusing tree-sitter is decided in M3, when tree-sitter arrives for Customizer parsing.

- [ ] **Step 1: Install CodeMirror**

```bash
npm i codemirror @codemirror/state @codemirror/view @codemirror/language @codemirror/lint @lezer/highlight
```

- [ ] **Step 2: Write the failing tests**

`src/editor/openscadLanguage.test.ts`:

```ts
import { StringStream } from '@codemirror/language'
import { openscadParser } from './openscadLanguage'

function tokens(line: string, state = openscadParser.startState!(2)) {
  const stream = new StringStream(line, 2, 2)
  const out: [string, string | null][] = []
  while (!stream.eol()) {
    const style = openscadParser.token(stream, state)
    if (stream.current().trim()) out.push([stream.current(), style ?? null])
    stream.start = stream.pos
  }
  return { out, state }
}

it('classifies keywords, builtins, numbers, strings and special variables', () => {
  expect(tokens('module m() cube([1.5, 2e3]) "a\\"b" $fn').out).toEqual([
    ['module', 'keyword'],
    ['m', 'variableName'],
    ['(', null],
    [')', null],
    ['cube', 'builtin'],
    ['(', null],
    ['[', null],
    ['1.5', 'number'],
    [',', null],
    ['2e3', 'number'],
    [']', null],
    [')', null],
    ['"a\\"b"', 'string'],
    ['$fn', 'atom'],
  ])
})

it('handles line comments and block comments spanning lines', () => {
  expect(tokens('x // note').out).toEqual([
    ['x', 'variableName'],
    ['// note', 'comment'],
  ])
  const first = tokens('a /* start')
  expect(first.out[0]).toEqual(['a', 'variableName'])
  expect(first.out.slice(1).every(([, style]) => style === 'comment')).toBe(true)
  expect(first.state.inComment).toBe(true)
  const second = tokens('still */ b', first.state)
  expect(second.out).toEqual([
    ['still */', 'comment'],
    ['b', 'variableName'],
  ])
})
```

`src/editor/diagnosticsExtension.test.ts`:

```ts
import { Text } from '@codemirror/state'
import { calloutHeadline, diagnosticsByLine } from './diagnosticsExtension'

const doc = Text.of(['cube(1);', 'sphere(', 'x'])

it('keeps one diagnostic per line, preferring errors over warnings, sorted by line', () => {
  const result = diagnosticsByLine(doc, [
    { line: 3, severity: 'warning', message: 'w3' },
    { line: 2, severity: 'warning', message: 'w2' },
    { line: 2, severity: 'error', message: 'e2' },
    { line: 2, severity: 'warning', message: 'w2 again' },
  ])
  expect(result).toEqual([
    { line: 2, severity: 'error', message: 'e2' },
    { line: 3, severity: 'warning', message: 'w3' },
  ])
})

it('clamps lines outside the document instead of throwing', () => {
  expect(diagnosticsByLine(doc, [{ line: 99, severity: 'error', message: 'late' }, { line: 0, severity: 'warning', message: 'early' }])).toEqual([
    { line: 1, severity: 'warning', message: 'early' },
    { line: 3, severity: 'error', message: 'late' },
  ])
})

it('writes the headline in the design system voice', () => {
  expect(calloutHeadline({ line: 16, severity: 'error', message: 'Parser error: syntax error' })).toBe(
    'Line 16: Parser error: syntax error',
  )
})
```

`src/editor/CodeEditor.test.tsx`:

```tsx
import { highlightingFor } from '@codemirror/language'
import { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { render, screen } from '@testing-library/react'
import { CodeEditor, toCmDiagnostics } from './CodeEditor'

function viewOf(container: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
  if (!view) throw new Error('no EditorView')
  return view
}

it('shows the initial value', () => {
  render(<CodeEditor value="cube(10);" onChange={() => {}} diagnostics={[]} />)
  expect(screen.getByTestId('code-editor')).toHaveTextContent('cube(10);')
})

it('calls onChange with the full document when the user edits', () => {
  const onChange = vi.fn()
  const { container } = render(<CodeEditor value="cube(10);" onChange={onChange} diagnostics={[]} />)
  const view = viewOf(container)
  view.dispatch({ changes: { from: view.state.doc.length, insert: '\nsphere(5);' } })
  expect(onChange).toHaveBeenLastCalledWith('cube(10);\nsphere(5);')
})

it('replaces the document when the value prop changes externally', () => {
  const { container, rerender } = render(<CodeEditor value="a" onChange={() => {}} diagnostics={[]} />)
  rerender(<CodeEditor value="b" onChange={() => {}} diagnostics={[]} />)
  expect(viewOf(container).state.doc.toString()).toBe('b')
})

it('colours keywords with the syn-keyword token class', () => {
  const { container } = render(<CodeEditor value="module m() {}" onChange={() => {}} diagnostics={[]} />)
  const cls = highlightingFor(viewOf(container).state, [tags.keyword])
  expect(cls).toBeTruthy()
  const keyword = container.querySelector(`.${cls!.split(' ').join('.')}`)
  expect(keyword).toHaveTextContent('module')
})

it('marks the error line, colours its gutter number, and shows the callout as text only', () => {
  const evil = 'syntax error <img src=x onerror=alert(1)>'
  const { container } = render(
    <CodeEditor value={'cube(1);\nsphere(\nx'} onChange={() => {}} diagnostics={[{ line: 2, severity: 'error', message: evil }]} />,
  )
  expect(container.querySelector('.cm-diag-line-error')).toHaveTextContent('sphere(')
  expect(container.querySelector('.cm-gutterElement.cm-diag-gutter-error')).toHaveTextContent('2')
  const callout = container.querySelector('.cm-diag-callout')
  expect(callout).toHaveClass('pc-callout', 'is-error')
  expect(callout).toHaveTextContent(`Line 2: ${evil}`)
  expect(callout?.querySelector('img')).toBeNull()
})

it('reveals a requested line by selecting its start', () => {
  const { container, rerender } = render(<CodeEditor value={'a\nb\nc'} onChange={() => {}} diagnostics={[]} reveal={null} />)
  rerender(<CodeEditor value={'a\nb\nc'} onChange={() => {}} diagnostics={[]} reveal={{ line: 3, id: 1 }} />)
  expect(viewOf(container).state.selection.main.head).toBe(4)
})

describe('toCmDiagnostics', () => {
  const doc = Text.of(['cube(1);', 'sphere(', 'x'])
  it('spans the whole reported line with the headline as the message', () => {
    expect(toCmDiagnostics(doc, [{ line: 2, severity: 'error', message: 'syntax error' }])).toEqual([
      { from: 9, to: 16, severity: 'error', message: 'Line 2: syntax error' },
    ])
  })
  it('clamps lines outside the document instead of throwing', () => {
    const [d] = toCmDiagnostics(doc, [{ line: 99, severity: 'warning', message: 'w' }])
    expect(d).toMatchObject({ from: 17, to: 18 })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/editor`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 4: Implement the language**

`src/editor/openscadLanguage.ts`:

```ts
import { StreamLanguage, type StreamParser } from '@codemirror/language'

const KEYWORDS = new Set([
  'module', 'function', 'if', 'else', 'for', 'let', 'each', 'include', 'use',
  'true', 'false', 'undef', 'intersection_for', 'assert', 'echo',
])

const BUILTINS = new Set([
  'cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'text', 'import', 'surface',
  'union', 'difference', 'intersection', 'translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'color',
  'offset', 'hull', 'minkowski', 'resize', 'linear_extrude', 'rotate_extrude', 'projection', 'render',
  'children', 'abs', 'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'floor', 'round', 'ceil',
  'ln', 'log', 'pow', 'sqrt', 'exp', 'min', 'max', 'norm', 'cross', 'len', 'concat', 'lookup', 'str', 'chr',
  'ord', 'search', 'rands', 'is_num', 'is_string', 'is_bool', 'is_list', 'is_undef', 'is_function',
])

export const openscadParser: StreamParser<{ inComment: boolean }> = {
  name: 'openscad',
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/')
        state.inComment = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inComment = true
      return 'comment'
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i)) return 'number'
    if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) return 'atom'
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current()
      if (KEYWORDS.has(word)) return 'keyword'
      if (BUILTINS.has(word)) return 'builtin'
      return 'variableName'
    }
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
}

export const openscad = () => StreamLanguage.define(openscadParser)
```

- [ ] **Step 5: Implement the token theme**

`src/editor/theme.ts`. Everything is a CSS variable, so the editor follows the theme without re-creating the view. StreamParser style names map to Lezer tags as `keyword → tags.keyword`, `builtin → tags.standard(tags.variableName)`, `number`, `string`, `comment`; `atom` (`$fn`) stays `ink`, as in the screens.

```ts
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export const openscadHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)' },
  { tag: tags.standard(tags.variableName), color: 'var(--syn-builtin)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.comment, color: 'var(--syn-comment)' },
])

const chrome = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--inset)', color: 'var(--ink)', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--ink)', padding: 'var(--space-2) 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'var(--inset)', color: 'var(--syn-comment)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--space-2) 0 var(--space-3)', minWidth: '44px' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--line-strong)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--error)' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--panel-raised)',
    color: 'var(--ink)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-pop)',
    fontFamily: 'var(--font-sans)',
  },
  // diagnosticsExtension (Step 6)
  '.cm-diag-line-error': { backgroundColor: 'var(--error-soft)' },
  '.cm-diag-line-warning': { backgroundColor: 'var(--warn-soft)' },
  '.cm-gutterElement.cm-diag-gutter-error': { color: 'var(--error)' },
  '.cm-gutterElement.cm-diag-gutter-warning': { color: 'var(--warn)' },
  '.cm-diag-callout': {
    margin: 'var(--space-1) var(--space-3) var(--space-1) 0',
    fontFamily: 'var(--font-sans)',
    fontSize: '14px',
    lineHeight: '20px',
    whiteSpace: 'normal',
  },
})

export const tokenTheme: Extension = [chrome, syntaxHighlighting(openscadHighlight)]
```

- [ ] **Step 6: Implement the diagnostics extension**

`src/editor/diagnosticsExtension.ts`:

```ts
import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutterLineClass, WidgetType } from '@codemirror/view'
import type { Diagnostic } from '../render/types'

export const setAppDiagnostics = StateEffect.define<readonly Diagnostic[]>()

/** One diagnostic per line (errors beat warnings), clamped into the document, sorted by line. */
export function diagnosticsByLine(doc: Text, diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const byLine = new Map<number, Diagnostic>()
  for (const d of diagnostics) {
    const line = Math.min(Math.max(d.line, 1), doc.lines)
    const existing = byLine.get(line)
    if (!existing || (existing.severity === 'warning' && d.severity === 'error')) byLine.set(line, { ...d, line })
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

export function calloutHeadline(d: Diagnostic): string {
  return `Line ${d.line}: ${d.message}`
}

class CalloutWidget extends WidgetType {
  constructor(readonly diagnostic: Diagnostic) {
    super()
  }

  eq(other: CalloutWidget): boolean {
    const a = this.diagnostic
    const b = other.diagnostic
    return a.line === b.line && a.severity === b.severity && a.message === b.message
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = `pc-callout cm-diag-callout is-${this.diagnostic.severity === 'error' ? 'error' : 'warn'}`
    el.setAttribute('role', 'note')
    const body = document.createElement('div')
    body.className = 'pc-callout-body'
    const headline = document.createElement('strong')
    headline.textContent = calloutHeadline(this.diagnostic) // text only: the message is model output
    body.append(headline)
    el.append(body)
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}

class ToneMarker extends GutterMarker {
  constructor(readonly elementClass: string) {
    super()
  }
}

const diagnosticsField = StateField.define<readonly Diagnostic[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAppDiagnostics)) return e.value
    return value
  },
})

const lineDecorations = EditorView.decorations.compute(['doc', diagnosticsField], (state) => {
  const builder = new RangeSetBuilder<Decoration>()
  for (const d of diagnosticsByLine(state.doc, state.field(diagnosticsField))) {
    const line = state.doc.line(d.line)
    builder.add(line.from, line.from, Decoration.line({ class: `cm-diag-line cm-diag-line-${d.severity}` }))
    builder.add(line.to, line.to, Decoration.widget({ widget: new CalloutWidget(d), block: true, side: 1 }))
  }
  return builder.finish()
})

const gutterTones = gutterLineClass.compute(['doc', diagnosticsField], (state) => {
  const builder = new RangeSetBuilder<GutterMarker>()
  for (const d of diagnosticsByLine(state.doc, state.field(diagnosticsField))) {
    const line = state.doc.line(d.line)
    builder.add(line.from, line.from, new ToneMarker(`cm-diag-gutter-${d.severity}`))
  }
  return builder.finish()
})

export const diagnosticsExtension: Extension = [diagnosticsField, lineDecorations, gutterTones]
```

- [ ] **Step 7: Implement the editor component**

`src/editor/CodeEditor.tsx`:

```tsx
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { EditorState, type Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import type { Diagnostic } from '../render/types'
import type { RevealRequest } from '../state/store'
import { calloutHeadline, diagnosticsByLine, diagnosticsExtension, setAppDiagnostics } from './diagnosticsExtension'
import { openscad } from './openscadLanguage'
import { tokenTheme } from './theme'

export function toCmDiagnostics(doc: Text, diagnostics: Diagnostic[]): CmDiagnostic[] {
  return diagnosticsByLine(doc, diagnostics).map((d) => {
    const line = doc.line(d.line)
    return { from: line.from, to: line.to, severity: d.severity, message: calloutHeadline(d) }
  })
}

interface Props {
  value: string
  onChange(code: string): void
  diagnostics: Diagnostic[]
  reveal?: RevealRequest | null
}

export function CodeEditor({ value, onChange, diagnostics, reveal = null }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          openscad(),
          tokenTheme,
          diagnosticsExtension,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // The initial value is applied once; later changes go through the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // setDiagnostics() returns a TransactionSpec with its own lint effect; keep it and add ours.
    const spec = setDiagnostics(view.state, toCmDiagnostics(view.state.doc, diagnostics))
    const lintEffects = Array.isArray(spec.effects) ? spec.effects : spec.effects ? [spec.effects] : []
    view.dispatch({ ...spec, effects: [...lintEffects, setAppDiagnostics.of(diagnostics)] })
  }, [diagnostics])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !reveal) return
    const line = view.state.doc.line(Math.min(Math.max(reveal.line, 1), view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
  }, [reveal])

  return <div ref={hostRef} className="h-full min-h-0 bg-inset" data-testid="code-editor" />
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/editor && npm run typecheck && npm test`
Expected: PASS, no type errors, and the no-hard-coded-colours scan still passes (every colour in `theme.ts` is a `var(--…)`). If `StringStream`'s constructor signature differs in the installed version, check `node_modules/@codemirror/language/dist/index.d.ts` and adjust the test helper to match. Do not change the parser for this.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/editor
git commit -m "feat(editor): CodeMirror 6 with token theme, OpenSCAD highlighting, inline diagnostics and go-to-line"
```

---

### Task 10: Status pill, dimension readout and console panel

**Files:**
- Create: `src/ui/StatusPill.tsx`, `src/ui/DimsReadout.tsx`, `src/panels/ConsolePanel.tsx`
- Modify: `src/index.css`
- Test: `src/ui/StatusPill.test.tsx`, `src/ui/DimsReadout.test.tsx`, `src/panels/ConsolePanel.test.tsx`

**Interfaces:**
- Consumes: `LogLine`, `Bounds`, `Diagnostic` (Task 4); `parseDiagnosticLine` (Task 4); `formatDims`, `formatDimParts` (Task 5); `RenderStatus` (Task 8); icons (Task 2); `pc-status`, `pc-dims`, `pc-console`, `pc-log`, `pc-label`, `pc-caption`, `pc-mono` classes (Task 2).
- Produces:
  - `describeStatus(status: RenderStatus, renderMs: number | null, error: string | null, diagnostics: Diagnostic[]): StatusDescription` with `{ tone: 'busy' | 'ok' | 'warn' | 'error'; label: string; ms: string | null; suffix: string; line: number | null; title: string | null }`
  - `<StatusPill status renderMs error diagnostics onGoToLine?={(line: number) => void} />`, which renders `data-testid="render-status"`; a `<button>` when it names a line, else a `<span>`
  - `<DimsReadout bounds={Bounds} axes?={boolean} />`, which renders `data-testid="dims"` (inline form "20 × 20 × 10 mm") or `data-testid="dims-axes"` (axis form, for the viewer overlay)
  - `logTone(line: LogLine): LogTone`, `summaryLine(status, error, renderMs, logs): { text: string; tone: LogTone } | null`
  - `<ConsolePanel status logs error renderMs onGoToLine?={(line: number) => void} />`, which renders `data-testid="console"` around the lines

StatusPill rules (component doc): "Always icon plus word; colour alone never carries the state." "Put render time in `.pc-mono` inside the pill: 'Rendered 412 ms'." "A failure names the first error line ('Failed · line 7'); clicking it scrolls the editor there." The preview also shows "Loading OpenSCAD…", "Rendering…", "3 warnings" and "Timed out after 60 s".

Console rules: tones `is-muted` (progress, timing), `is-warn`, `is-error`, `is-ok`; "ERROR and WARNING lines that name a line in main.scad link to that line in the editor"; "Keep it scrolled to the newest line"; "Render every line as text." The Compile error screen ends the log with a muted summary ("OpenSCAD exited with code 1 · 38 ms"). When OpenSCAD printed no ERROR line of its own (timeout, crash, empty model) the summary is the only explanation, so it takes the `is-error` tone.

- [ ] **Step 1: Write the failing tests**

`src/ui/StatusPill.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Diagnostic } from '../render/types'
import { StatusPill } from './StatusPill'

const errAt7: Diagnostic = { line: 7, severity: 'error', message: 'Parser error: syntax error' }
const warn: Diagnostic = { line: 2, severity: 'warning', message: "Ignoring unknown variable 'x'" }

it('shows a busy pill with an icon while OpenSCAD loads', () => {
  render(<StatusPill status="idle" renderMs={null} error={null} diagnostics={[]} />)
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent('Loading OpenSCAD…')
  expect(pill).toHaveClass('pc-status', 'is-busy')
  expect(pill.querySelector('svg.pc-i')).not.toBeNull()
})

it('shows "Rendering…" while a render runs', () => {
  render(<StatusPill status="rendering" renderMs={null} error={null} diagnostics={[]} />)
  expect(screen.getByTestId('render-status')).toHaveTextContent('Rendering…')
  expect(screen.getByTestId('render-status')).toHaveClass('is-busy')
})

it('shows the render time in mono after success', () => {
  render(<StatusPill status="ok" renderMs={412.4} error={null} diagnostics={[]} />)
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent('Rendered 412 ms')
  expect(pill).toHaveClass('is-ok')
  expect(pill.querySelector('.pc-mono')).toHaveTextContent('412 ms')
})

it('turns to the warn tone and counts warnings', () => {
  render(<StatusPill status="ok" renderMs={50} error={null} diagnostics={[warn, { ...warn, line: 5 }]} />)
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent('Rendered 50 ms · 2 warnings')
  expect(pill).toHaveClass('is-warn')
})

it('names the first error line, explains in the tooltip, and jumps there on click', async () => {
  const onGoToLine = vi.fn()
  render(<StatusPill status="error" renderMs={38} error="OpenSCAD exited with code 1" diagnostics={[warn, errAt7]} onGoToLine={onGoToLine} />)
  const pill = screen.getByRole('button', { name: 'Failed · line 7' })
  expect(pill).toHaveClass('is-error')
  expect(pill).toHaveAttribute('title', 'OpenSCAD exited with code 1')
  await userEvent.click(pill)
  expect(onGoToLine).toHaveBeenCalledWith(7)
})

it('says "Timed out after 60 s" for a timeout', () => {
  render(<StatusPill status="error" renderMs={60_000} error="Render timed out after 60 s" diagnostics={[]} />)
  expect(screen.getByTestId('render-status')).toHaveTextContent('Timed out after 60 s')
  expect(screen.queryByRole('button')).toBeNull()
})

it('falls back to "Failed" with the reason as a tooltip', () => {
  render(<StatusPill status="error" renderMs={5} error="Render worker crashed: worker died" diagnostics={[]} />)
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent(/^Failed$/)
  expect(pill).toHaveAttribute('title', 'Render worker crashed: worker died')
})
```

`src/ui/DimsReadout.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { DimsReadout } from './DimsReadout'

const box = { min: [0, 0, 0] as [number, number, number], max: [88.8, 25.4, 22] as [number, number, number] }

it('renders the inline form', () => {
  render(<DimsReadout bounds={box} />)
  const dims = screen.getByTestId('dims')
  expect(dims).toHaveTextContent('88.8 × 25.4 × 22 mm')
  expect(dims).toHaveClass('pc-dims')
})

it('renders the axis form with coloured axis letters and a readable label', () => {
  render(<DimsReadout bounds={box} axes />)
  const dims = screen.getByTestId('dims-axes')
  expect(dims).toHaveAttribute('aria-label', '88.8 × 25.4 × 22 mm')
  expect(dims.querySelector('.x')).toHaveTextContent('X')
  expect(dims.querySelector('.y')).toHaveTextContent('Y')
  expect(dims.querySelector('.z')).toHaveTextContent('Z')
  expect(dims).toHaveTextContent('X 88.8')
  expect(dims).toHaveTextContent('Z 22')
  expect(dims).toHaveTextContent('mm')
})
```

`src/panels/ConsolePanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LogLine } from '../render/types'
import { ConsolePanel } from './ConsolePanel'

const out = (text: string): LogLine => ({ stream: 'stdout', text })
const err = (text: string): LogLine => ({ stream: 'stderr', text })
const lines = () => Array.from(screen.getByTestId('console').children) as HTMLElement[]

it('tones each line like the design system console', () => {
  render(
    <ConsolePanel
      status="error"
      renderMs={38}
      error="OpenSCAD exited with code 1"
      logs={[
        err('Parsing design (AST generation)...'),
        out('ECHO: "wall = 2"'),
        err("WARNING: Ignoring unknown variable 'lid_h' in file main.scad, line 12"),
        err('ERROR: Parser error in file "/main.scad", line 7: syntax error'),
        err('Execution aborted'),
      ]}
    />,
  )
  expect(lines().map((l) => [l.textContent, l.className.trim()])).toEqual([
    ['Parsing design (AST generation)...', 'pc-log is-muted'],
    ['ECHO: "wall = 2"', 'pc-log'],
    ["WARNING: Ignoring unknown variable 'lid_h' in file main.scad, line 12", expect.stringContaining('pc-log is-warn')],
    ['ERROR: Parser error in file "/main.scad", line 7: syntax error', expect.stringContaining('pc-log is-error')],
    ['Execution aborted', 'pc-log is-error'],
    ['OpenSCAD exited with code 1 · 38 ms', 'pc-log is-muted'],
  ])
})

it('marks OpenSCAD timing as ok and adds a render summary on success', () => {
  render(<ConsolePanel status="ok" renderMs={412} error={null} logs={[err('Total rendering time: 0:00:00.412')]} />)
  expect(lines().map((l) => [l.textContent, l.className.trim()])).toEqual([
    ['Total rendering time: 0:00:00.412', 'pc-log is-ok'],
    ['Rendered in 412 ms', 'pc-log is-ok'],
  ])
})

it('uses the error tone for the summary when OpenSCAD printed no ERROR line (timeout, crash, empty model)', () => {
  render(<ConsolePanel status="error" renderMs={60_000} error="Render timed out after 60 s" logs={[]} />)
  expect(lines().map((l) => [l.textContent, l.className.trim()])).toEqual([
    ['Render timed out after 60 s · 60000 ms', 'pc-log is-error'],
  ])
})

it('shows a loading line before the first render and a compiling line during one', () => {
  const { rerender } = render(<ConsolePanel status="idle" renderMs={null} error={null} logs={[]} />)
  expect(screen.getByTestId('console')).toHaveTextContent('Loading OpenSCAD…')
  rerender(<ConsolePanel status="rendering" renderMs={null} error={null} logs={[]} />)
  expect(screen.getByTestId('console')).toHaveTextContent('Compiling main.scad…')
})

it('makes located ERROR and WARNING lines jump to the editor line', async () => {
  const onGoToLine = vi.fn()
  render(
    <ConsolePanel
      status="error"
      renderMs={1}
      error="OpenSCAD exited with code 1"
      logs={[out('ECHO: 1'), err("WARNING: Ignoring unknown variable 'x' in file main.scad, line 2"), err('ERROR: Parser error in file "/main.scad", line 7: syntax error')]}
      onGoToLine={onGoToLine}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: /line 7/ }))
  expect(onGoToLine).toHaveBeenLastCalledWith(7)
  await userEvent.click(screen.getByRole('button', { name: /line 2/ }))
  expect(onGoToLine).toHaveBeenLastCalledWith(2)
  expect(screen.getByText('ECHO: 1').tagName).toBe('DIV')
})

it('renders model output as plain text, never as HTML', () => {
  const evil = 'ECHO: "<img src=x onerror=alert(1)>"'
  render(<ConsolePanel status="ok" renderMs={1} error={null} logs={[out(evil)]} />)
  expect(screen.getByText(evil)).toBeInTheDocument()
  expect(screen.getByTestId('console').querySelector('img')).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui src/panels`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 3: Implement StatusPill and DimsReadout**

`src/ui/StatusPill.tsx`:

```tsx
import type { Diagnostic } from '../render/types'
import type { RenderStatus } from '../state/store'
import { IconCheck, IconSpinner, IconWarning, IconX } from './icons'

export type PillTone = 'busy' | 'ok' | 'warn' | 'error'

export interface StatusDescription {
  tone: PillTone
  label: string
  /** Render time, shown in mono after the label. */
  ms: string | null
  /** Trailing text after the time, e.g. " · 2 warnings". */
  suffix: string
  /** First error line, when the failure names one. */
  line: number | null
  /** Full reason, for the tooltip. */
  title: string | null
}

const TIMEOUT = /timed out after (\d+ s)/i

export function describeStatus(
  status: RenderStatus,
  renderMs: number | null,
  error: string | null,
  diagnostics: Diagnostic[],
): StatusDescription {
  const base = { ms: null, suffix: '', line: null, title: null }
  switch (status) {
    case 'idle':
      return { ...base, tone: 'busy', label: 'Loading OpenSCAD…' }
    case 'rendering':
      return { ...base, tone: 'busy', label: 'Rendering…' }
    case 'ok': {
      const warnings = diagnostics.filter((d) => d.severity === 'warning').length
      return {
        ...base,
        tone: warnings > 0 ? 'warn' : 'ok',
        label: 'Rendered',
        ms: `${Math.round(renderMs ?? 0)} ms`,
        suffix: warnings > 0 ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '',
      }
    }
    case 'error': {
      const first = diagnostics.find((d) => d.severity === 'error')
      if (first) return { ...base, tone: 'error', label: `Failed · line ${first.line}`, line: first.line, title: error }
      const timeout = TIMEOUT.exec(error ?? '')
      return { ...base, tone: 'error', label: timeout ? `Timed out after ${timeout[1]}` : 'Failed', title: error }
    }
  }
}

const ICONS = { busy: IconSpinner, ok: IconCheck, warn: IconWarning, error: IconX } as const

interface Props {
  status: RenderStatus
  renderMs: number | null
  error: string | null
  diagnostics: Diagnostic[]
  onGoToLine?(line: number): void
}

export function StatusPill({ status, renderMs, error, diagnostics, onGoToLine }: Props) {
  const d = describeStatus(status, renderMs, error, diagnostics)
  const Icon = ICONS[d.tone]
  const className = `pc-status is-${d.tone}`
  const content = (
    <>
      <Icon className="pc-i" aria-hidden="true" />
      {d.label}
      {d.ms && (
        <>
          {' '}
          <span className="pc-mono">{d.ms}</span>
        </>
      )}
      {d.suffix}
    </>
  )
  if (d.line !== null && onGoToLine) {
    const line = d.line
    return (
      <button
        type="button"
        data-testid="render-status"
        className={`${className} cursor-pointer`}
        title={d.title ?? undefined}
        onClick={() => onGoToLine(line)}
      >
        {content}
      </button>
    )
  }
  return (
    <span data-testid="render-status" role="status" className={className} title={d.title ?? undefined}>
      {content}
    </span>
  )
}
```

`src/ui/DimsReadout.tsx`:

```tsx
import { formatDimParts, formatDims } from '../render/dims'
import type { Bounds } from '../render/types'

/** Bounding-box size of the last good mesh. Inline in the header; axis form over the viewer. */
export function DimsReadout({ bounds, axes = false }: { bounds: Bounds; axes?: boolean }) {
  if (!axes) {
    return (
      <span className="pc-dims" data-testid="dims">
        {formatDims(bounds)}
      </span>
    )
  }
  const [x, y, z] = formatDimParts(bounds)
  return (
    <span className="pc-dims" data-testid="dims-axes" aria-label={formatDims(bounds)}>
      <span>
        <span className="x">X</span> {x}
      </span>
      <span>
        <span className="y">Y</span> {y}
      </span>
      <span>
        <span className="z">Z</span> {z}
      </span>
      <span className="pc-muted">mm</span>
    </span>
  )
}
```

- [ ] **Step 4: Implement ConsolePanel**

`src/panels/ConsolePanel.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { parseDiagnosticLine } from '../render/diagnostics'
import type { LogLine } from '../render/types'
import type { RenderStatus } from '../state/store'

export type LogTone = '' | 'is-muted' | 'is-ok' | 'is-warn' | 'is-error'

export function logTone({ stream, text }: LogLine): LogTone {
  if (/^ERROR\b/.test(text) || /^Execution aborted/.test(text)) return 'is-error'
  if (/^(WARNING|DEPRECATED)\b/.test(text)) return 'is-warn'
  if (/^Total rendering time/.test(text)) return 'is-ok'
  if (/^ECHO\b/.test(text)) return ''
  return stream === 'stderr' ? 'is-muted' : ''
}

export function summaryLine(
  status: RenderStatus,
  error: string | null,
  renderMs: number | null,
  logs: LogLine[],
): { text: string; tone: LogTone } | null {
  const ms = `${Math.round(renderMs ?? 0)} ms`
  switch (status) {
    case 'idle':
      return { text: 'Loading OpenSCAD…', tone: 'is-muted' }
    case 'rendering':
      return { text: 'Compiling main.scad…', tone: 'is-muted' }
    case 'ok':
      return { text: `Rendered in ${ms}`, tone: 'is-ok' }
    case 'error': {
      const explained = logs.some((l) => /^ERROR\b/.test(l.text))
      return { text: `${error ?? 'Render failed'} · ${ms}`, tone: explained ? 'is-muted' : 'is-error' }
    }
  }
}

interface Props {
  status: RenderStatus
  logs: LogLine[]
  error: string | null
  renderMs: number | null
  onGoToLine?(line: number): void
}

export function ConsolePanel({ status, logs, error, renderMs, onGoToLine }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs, error, status])

  const summary = summaryLine(status, error, renderMs, logs)

  return (
    <section className="pc-console flex h-full flex-col rounded-none border-0" aria-label="Console">
      <div className="pc-console-head shrink-0">
        <span className="pc-label">Console</span>
        <span className="pc-caption ml-auto">OpenSCAD · manifold</span>
      </div>
      <div ref={ref} data-testid="console" className="min-h-0 flex-1 overflow-auto py-1">
        {logs.map((line, i) => {
          const className = `pc-log ${logTone(line)}`.trim()
          const located = parseDiagnosticLine(line.text)
          return located && onGoToLine ? (
            <button
              key={i}
              type="button"
              className={className}
              title={`Go to line ${located.line}`}
              onClick={() => onGoToLine(located.line)}
            >
              {line.text}
            </button>
          ) : (
            <div key={i} className={className}>
              {line.text}
            </div>
          )
        })}
        {summary && <div className={`pc-log ${summary.tone}`.trim()}>{summary.text}</div>}
      </div>
    </section>
  )
}
```

A `<button>` carries browser button styling that `.pc-log` does not reset. Add to the `@layer base` block in `src/index.css` (the `components` layer's `.pc-log.is-error` ground still wins over this):

```css
  button.pc-log {
    appearance: none;
    width: 100%;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button.pc-log:hover {
    text-decoration: underline;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ui src/panels && npm run typecheck && npm test`
Expected: PASS, no type errors, no-hard-coded-colours scan still green.

- [ ] **Step 6: Commit**

```bash
git add src/ui src/panels src/index.css
git commit -m "feat(ui): status pill, dims readout and console panel as design-system components"
```

---

### Task 11: three.js viewer (token colours, Z-up scene, stale state, overlays)

**Files:**
- Create: `src/viewer/geometry.ts`, `src/viewer/cameraFit.ts`, `src/viewer/Viewer.tsx`
- Test: `src/viewer/geometry.test.ts`, `src/viewer/cameraFit.test.ts`

**Interfaces:**
- Consumes: `MeshData`, `Bounds`, `Vec3` (Task 4); `parseStl` and test helpers (Task 5); `useTokens` (Task 2); `DimsReadout` (Task 10); `IconFit`, `IconWarning` (Task 2).
- Produces:
  - `meshToGeometry(mesh: MeshData): BufferGeometry`
  - `interface CameraFit { position: Vec3; target: Vec3; distance: number }` and `computeCameraFit(bounds: Bounds, fovDeg: number, aspect: number, margin?: number): CameraFit`
  - `<Viewer mesh={MeshData | null} stale={boolean} />`, which renders `data-testid="viewer"` with a `<canvas>`, a "Fit view" button, the axis-form `DimsReadout` (or the stale notice) top-left, the triangle count bottom-left and an axis gizmo bottom-right

From the screens: the viewer ground is `viewport`; the grid has 1 mm `grid-minor` cells and 10 mm `grid-major` sections; the axes and the gizmo use `axis-x/y/z` (RGB = XYZ); the model is `filament`; when the current code failed, the last good model stays at 55 % opacity (`scene.is-stale`) under a `pc-status is-warn` notice "Showing the last model that compiled". WebGL needs literal colours, so `useTokens` supplies them and keeps them in step with the theme.

`<Viewer>` needs WebGL, so jsdom can't render it. Its pure parts are unit-tested here, and the component is covered by Playwright in Task 13.

- [ ] **Step 1: Install three.js stack**

```bash
npm i three @react-three/fiber @react-three/drei
npm i -D @types/three
```

- [ ] **Step 2: Write the failing tests**

`src/viewer/geometry.test.ts`:

```ts
import { parseStl } from '../render/stl'
import { binaryStl, BOX_TRI } from '../test/stl'
import { meshToGeometry } from './geometry'

it('builds a non-indexed geometry with positions, normals and a bounding box', () => {
  const g = meshToGeometry(parseStl(binaryStl([BOX_TRI])))
  expect(g.getAttribute('position').count).toBe(3)
  expect(g.getAttribute('normal').count).toBe(3)
  expect(g.boundingBox?.max.toArray()).toEqual([20, 20, 10])
})
```

`src/viewer/cameraFit.test.ts`:

```ts
import { computeCameraFit } from './cameraFit'

const box = { min: [0, 0, 0] as [number, number, number], max: [20, 20, 10] as [number, number, number] }

it('targets the bounding box centre', () => {
  expect(computeCameraFit(box, 45, 1).target).toEqual([10, 10, 5])
})

it('places the camera far enough to contain the bounding sphere', () => {
  const fit = computeCameraFit(box, 45, 1, 1)
  const radius = Math.hypot(20, 20, 10) / 2
  expect(fit.distance).toBeGreaterThanOrEqual(radius / Math.sin((45 * Math.PI) / 360) - 1e-9)
  const [px, py, pz] = fit.position
  expect(Math.hypot(px - 10, py - 10, pz - 5)).toBeCloseTo(fit.distance)
})

it('backs off further on a narrow (portrait) viewport', () => {
  expect(computeCameraFit(box, 45, 0.5).distance).toBeGreaterThan(computeCameraFit(box, 45, 1).distance)
})

it('views from the front-right and above in Z-up space', () => {
  const [px, py, pz] = computeCameraFit(box, 45, 1).position
  expect(px).toBeGreaterThan(10)
  expect(py).toBeLessThan(10)
  expect(pz).toBeGreaterThan(5)
})

it('uses a minimum radius for degenerate bounds', () => {
  expect(computeCameraFit({ min: [0, 0, 0], max: [0, 0, 0] }, 45, 1).distance).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/viewer`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 4: Implement the pure modules**

`src/viewer/geometry.ts`:

```ts
import { BufferAttribute, BufferGeometry } from 'three'
import type { MeshData } from '../render/types'

export function meshToGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
```

`src/viewer/cameraFit.ts`:

```ts
import type { Bounds, Vec3 } from '../render/types'

export interface CameraFit {
  position: Vec3
  target: Vec3
  distance: number
}

const MIN_RADIUS = 1
const VIEW_DIR: Vec3 = (() => {
  const d: Vec3 = [1, -1.2, 0.9]
  const len = Math.hypot(...d)
  return [d[0] / len, d[1] / len, d[2] / len]
})()

export function computeCameraFit(bounds: Bounds, fovDeg: number, aspect: number, margin = 1.2): CameraFit {
  const { min, max } = bounds
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, MIN_RADIUS)
  const vFov = (fovDeg * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  const distance = (radius * margin) / Math.sin(Math.min(vFov, hFov) / 2)
  const position: Vec3 = [
    target[0] + VIEW_DIR[0] * distance,
    target[1] + VIEW_DIR[1] * distance,
    target[2] + VIEW_DIR[2] * distance,
  ]
  return { position, target, distance }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/viewer`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the Viewer component**

`src/viewer/Viewer.tsx`:

```tsx
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AxesHelper, Color, Object3D, type PerspectiveCamera, type Vector3 } from 'three'
import type { Bounds, MeshData } from '../render/types'
import { useTokens } from '../theme/tokens'
import { DimsReadout } from '../ui/DimsReadout'
import { IconFit, IconWarning } from '../ui/icons'
import { computeCameraFit } from './cameraFit'
import { meshToGeometry } from './geometry'

// OpenSCAD is Z-up. This must run before any camera or controls are created.
Object3D.DEFAULT_UP.set(0, 0, 1)

const TOKENS = ['viewport', 'filament', 'grid-minor', 'grid-major', 'axis-x', 'axis-y', 'axis-z', 'ink'] as const

/** The screens dim the last good model to 55 % while the current code fails (`scene.is-stale`). */
const STALE_OPACITY = 0.55

function Model({ mesh, color, stale }: { mesh: MeshData; color: string; stale: boolean }) {
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} transparent={stale} opacity={stale ? STALE_OPACITY : 1} />
    </mesh>
  )
}

/** three.js's AxesHelper ships fixed RGB; recolour it from the axis tokens. */
function Axes({ colors }: { colors: readonly [string, string, string] }) {
  const ref = useRef<AxesHelper>(null)
  const [x, y, z] = colors
  useEffect(() => {
    ref.current?.setColors(new Color(x), new Color(y), new Color(z))
  }, [x, y, z])
  return <axesHelper ref={ref} args={[20]} />
}

interface ControlsLike {
  target: Vector3
  update(): void
}

/** Fits the camera to the first mesh only (and on each Fit request), so re-renders keep the user's camera. */
function CameraFitter({ bounds, fitToken }: { bounds: Bounds | null; fitToken: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const fittedToken = useRef<number | null>(null)

  useEffect(() => {
    if (!bounds || !controls || fittedToken.current === fitToken) return
    fittedToken.current = fitToken
    const fit = computeCameraFit(bounds, camera.fov, size.height > 0 ? size.width / size.height : 1)
    camera.position.set(...fit.position)
    camera.near = Math.max(fit.distance / 1000, 0.01)
    camera.far = fit.distance * 100
    camera.updateProjectionMatrix()
    controls.target.set(...fit.target)
    controls.update()
    invalidate()
  }, [bounds, fitToken, controls, camera, size, invalidate])

  return null
}

export function Viewer({ mesh, stale }: { mesh: MeshData | null; stale: boolean }) {
  const t = useTokens(TOKENS)
  const [fitToken, setFitToken] = useState(0)
  const axisColors = [t['axis-x'], t['axis-y'], t['axis-z']] as const

  return (
    <div className="relative h-full w-full bg-viewport" data-testid="viewer">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 45, near: 0.1, far: 10_000, position: [60, -80, 60] }}>
        <color attach="background" args={[t.viewport]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, -80, 100]} intensity={1.4} />
        <directionalLight position={[-60, 40, -30]} intensity={0.4} />
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          infiniteGrid
          cellSize={1}
          sectionSize={10}
          cellColor={t['grid-minor']}
          sectionColor={t['grid-major']}
          fadeDistance={400}
        />
        <Axes colors={axisColors} />
        {mesh && <Model mesh={mesh} color={t.filament} stale={stale} />}
        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[48, 48]}>
          <GizmoViewport axisColors={[...axisColors]} labelColor={t.ink} />
        </GizmoHelper>
        <CameraFitter bounds={mesh?.bounds ?? null} fitToken={fitToken} />
      </Canvas>

      <div className="absolute top-3 left-3">
        {stale ? (
          <span className="pc-status is-warn">
            <IconWarning className="pc-i" aria-hidden="true" />
            Showing the last model that compiled
          </span>
        ) : (
          mesh && <DimsReadout bounds={mesh.bounds} axes />
        )}
      </div>

      <div className="absolute top-3 right-3">
        <button
          type="button"
          aria-label="Fit view"
          title="Fit view"
          className="grid size-(--control-sm) place-items-center rounded-sm border border-line bg-panel text-ink-muted hover:text-ink disabled:text-ink-disabled"
          onClick={() => setFitToken((n) => n + 1)}
          disabled={!mesh}
        >
          <IconFit className="pc-i" aria-hidden="true" />
        </button>
      </div>

      {mesh && (
        <div className="pc-caption pc-mono absolute bottom-3 left-3">
          {mesh.triangleCount.toLocaleString('en-US')} triangles
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Typecheck and run all tests**

Run: `npm run typecheck && npm test`
Expected: no type errors, all tests pass, no-hard-coded-colours scan still green (the only literals in `Viewer.tsx` are numbers).

```bash
git add package.json package-lock.json src/viewer
git commit -m "feat(viewer): Z-up three.js viewer in token colours with stale state, overlays, gizmo and Fit view"
```

---

### Task 12: STL and .scad export (Web Share with download fallback)

**Files:**
- Create: `src/export/saveFile.ts`, `src/export/ExportButtons.tsx`
- Test: `src/export/saveFile.test.ts`, `src/export/ExportButtons.test.tsx`

**Interfaces:**
- Consumes: `RenderStatus` (Task 8); `IconDownload` and the `pc-btn` classes (Task 2).
- Produces:
  - `type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'`
  - `saveFile(blob: Blob, filename: string, opts?: { preferShare?: boolean }): Promise<SaveOutcome>`, where `preferShare` defaults to `true` on coarse-pointer (touch) devices
  - `exportStl(stl: ArrayBuffer): Promise<SaveOutcome>` saves `model.stl` (`model/stl`), and `exportScad(code: string): Promise<SaveOutcome>` saves `model.scad` (`text/plain`)
  - `exportDisabledReason(status: RenderStatus): string | null` (`null` when STL export is allowed)
  - `<ExportButtons canExportStl={boolean} disabledReason={string | null} onExportStl={() => void} onExportScad={() => void} />`, with buttons named "Export STL" (`pc-btn is-sm is-primary`, the one primary action in the header) and "Export .scad" (`pc-btn is-sm`)

Button doc: "Disable Export STL while a render is running or the current code failed, so the file always matches the code. Leave Export .scad enabled." The Compile error screen gives the disabled button the tooltip "Fix the error first, so the file matches the code".

- [ ] **Step 1: Write the failing tests**

`src/export/saveFile.test.ts`:

```ts
import type { MockInstance } from 'vitest'
import { saveFile } from './saveFile'

const blob = new Blob(['solid x'], { type: 'model/stl' })
let click: MockInstance<() => void>

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
})

function mockShare(share: () => Promise<void>, canShare = true) {
  Object.defineProperty(navigator, 'share', { value: vi.fn(share), configurable: true })
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => canShare), configurable: true })
}

it('downloads via an anchor when sharing is not preferred', async () => {
  expect(await saveFile(blob, 'model.stl', { preferShare: false })).toBe('downloaded')
  expect(click).toHaveBeenCalledTimes(1)
  const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
  expect(anchor.download).toBe('model.stl')
  expect(anchor.href).toBe('blob:fake')
})

it('shares the file on devices that prefer sharing', async () => {
  mockShare(() => Promise.resolve())
  expect(await saveFile(blob, 'model.stl', { preferShare: true })).toBe('shared')
  const shared = (navigator.share as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ShareData
  expect(shared.files?.[0].name).toBe('model.stl')
  expect(click).not.toHaveBeenCalled()
})

it('does not download when the user cancels the share sheet', async () => {
  mockShare(() => Promise.reject(new DOMException('cancelled', 'AbortError')))
  expect(await saveFile(blob, 'model.stl', { preferShare: true })).toBe('cancelled')
  expect(click).not.toHaveBeenCalled()
})

it('falls back to download when sharing fails or files cannot be shared', async () => {
  mockShare(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
  expect(await saveFile(blob, 'a.stl', { preferShare: true })).toBe('downloaded')
  mockShare(() => Promise.resolve(), false)
  expect(await saveFile(blob, 'b.stl', { preferShare: true })).toBe('downloaded')
  expect(click).toHaveBeenCalledTimes(2)
})
```

`src/export/ExportButtons.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportButtons, exportDisabledReason } from './ExportButtons'

it('disables STL export with the reason as a tooltip, but keeps .scad export available', () => {
  render(
    <ExportButtons
      canExportStl={false}
      disabledReason="Fix the error first, so the file matches the code"
      onExportStl={() => {}}
      onExportScad={() => {}}
    />,
  )
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).toBeDisabled()
  expect(stl).toHaveAttribute('title', 'Fix the error first, so the file matches the code')
  expect(stl).toHaveClass('pc-btn', 'is-primary')
  expect(screen.getByRole('button', { name: 'Export .scad' })).toBeEnabled()
})

it('calls the handlers', async () => {
  const onExportStl = vi.fn()
  const onExportScad = vi.fn()
  render(<ExportButtons canExportStl disabledReason={null} onExportStl={onExportStl} onExportScad={onExportScad} />)
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).not.toHaveAttribute('title')
  await userEvent.click(stl)
  await userEvent.click(screen.getByRole('button', { name: 'Export .scad' }))
  expect(onExportStl).toHaveBeenCalledOnce()
  expect(onExportScad).toHaveBeenCalledOnce()
})

describe('exportDisabledReason', () => {
  it('explains each blocked state in plain words', () => {
    expect(exportDisabledReason('idle')).toBe('Wait for the first render to finish')
    expect(exportDisabledReason('rendering')).toBe('Wait for the render to finish')
    expect(exportDisabledReason('error')).toBe('Fix the error first, so the file matches the code')
    expect(exportDisabledReason('ok')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/export`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 3: Implement**

`src/export/saveFile.ts`:

```ts
export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'

function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

function download(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Web Share with a file on touch devices (downloads are unreliable on iOS), else a download link. */
export async function saveFile(
  blob: Blob,
  filename: string,
  { preferShare = isTouchDevice() }: { preferShare?: boolean } = {},
): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
  if (preferShare && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  download(file)
  return 'downloaded'
}

export const exportStl = (stl: ArrayBuffer) => saveFile(new Blob([stl], { type: 'model/stl' }), 'model.stl')
export const exportScad = (code: string) => saveFile(new Blob([code], { type: 'text/plain' }), 'model.scad')
```

`src/export/ExportButtons.tsx`:

```tsx
import type { RenderStatus } from '../state/store'
import { IconDownload } from '../ui/icons'

/** Why Export STL is disabled, or null when the file would match the code. */
export function exportDisabledReason(status: RenderStatus): string | null {
  switch (status) {
    case 'idle':
      return 'Wait for the first render to finish'
    case 'rendering':
      return 'Wait for the render to finish'
    case 'error':
      return 'Fix the error first, so the file matches the code'
    case 'ok':
      return null
  }
}

interface Props {
  canExportStl: boolean
  disabledReason: string | null
  onExportStl(): void
  onExportScad(): void
}

export function ExportButtons({ canExportStl, disabledReason, onExportStl, onExportScad }: Props) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="pc-btn is-sm" onClick={onExportScad}>
        Export .scad
      </button>
      <button
        type="button"
        className="pc-btn is-sm is-primary"
        disabled={!canExportStl}
        title={canExportStl ? undefined : (disabledReason ?? undefined)}
        onClick={onExportStl}
      >
        <IconDownload className="pc-i" aria-hidden="true" />
        Export STL
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/export && npm run typecheck`
Expected: PASS (7 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/export
git commit -m "feat(export): STL and .scad export with Web Share on touch devices, design-system buttons"
```

---

### Task 13: App shell, production CSP, and end-to-end smoke test

**Files:**
- Create: `build/csp.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `src/App.tsx`, `src/App.test.tsx`, `vite.config.ts`, `.gitignore`, `package.json`
- Test: `build/csp.test.ts`, `src/App.test.tsx`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: every earlier module: `useAppStore`, `selectCanExport`, `useRenderLoop`, `WorkerFactory`, `createRenderWorker`, `CodeEditor`, `Viewer`, `ConsolePanel`, `StatusPill`, `DimsReadout`, `ExportButtons`, `exportDisabledReason`, `exportStl`, `exportScad`.
- Produces:
  - `<App createWorker?={WorkerFactory} />`, where the default is the real worker and tests inject a fake
  - `CSP: string` and `cspPlugin(): Plugin` (build only: Vite dev needs inline scripts for React Refresh)
  - npm script `e2e`

Layout, from the Workbench screen: a 48px `panel` header with the wordmark, a 1px `line` separator, the status pill, the dimensions, and Export on the right; below it the workbench grid. M1 has two of the three columns: the 3D view (centre, flexible) and the code column (440px) with a 40px pane head holding a `pc-tabs` "main.scad" tab, the editor, and a 176px console. The chat column (360px) arrives in M2. Under `md` the two sections stack, viewer on top. Nothing in M1 opens a dialog.

- [ ] **Step 1: Write the failing tests (CSP plugin and App)**

`build/csp.test.ts`:

```ts
import type { Plugin } from 'vite'
import { CSP, cspPlugin } from './csp'

it('allows only self-hosted scripts plus WASM compilation, and self-hosted fonts', () => {
  expect(CSP).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(CSP).toContain("font-src 'self'")
  expect(CSP).toContain("object-src 'none'")
  expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/)
})

it('injects the CSP meta tag into production HTML only', () => {
  const plugin: Plugin = cspPlugin()
  expect(plugin.apply).toBe('build')
  const transform = plugin.transformIndexHtml as unknown as (html: string) => string
  expect(transform('<html><head><title>x</title></head></html>')).toContain(
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
  )
})
```

Replace `src/App.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import userEvent from '@testing-library/user-event'
import type { RenderWorkerHandle } from './render/createRenderWorker'
import type { RenderRequest, RenderResult } from './render/types'
import { useAppStore } from './state/store'
import { errorResult, okResult } from './test/results'
import { App } from './App'

vi.mock('./viewer/Viewer', () => ({
  Viewer: ({ stale }: { stale: boolean }) => <div data-testid="viewer" data-stale={String(stale)} />,
}))

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

function scriptedWorker(respond: (req: RenderRequest) => RenderResult) {
  const handle: RenderWorkerHandle = { render: async (req) => respond(req), terminate: () => {} }
  return () => handle
}

it('renders the default model, shows dims in the header, and enables STL export', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('heading', { name: 'PromptCAD' })).toBeInTheDocument()
  expect(screen.getByTestId('viewer')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'main.scad' })).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => expect(screen.getByTestId('dims')).toHaveTextContent('20 × 20 × 10 mm'))
  expect(screen.getByTestId('render-status')).toHaveTextContent('Rendered 12 ms')
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled()
  expect(screen.getByTestId('viewer')).toHaveAttribute('data-stale', 'false')
})

it('keeps the last mesh (dimmed) but disables STL export after a failed edit, without a dialog', async () => {
  const { container } = render(
    <App createWorker={scriptedWorker((req) => (req.code.includes('broken') ? errorResult() : okResult()))} />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled())

  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'broken(' } })

  await waitFor(() => expect(screen.getByTestId('render-status')).toHaveTextContent('Failed · line 1'), { timeout: 3_000 })
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).toBeDisabled()
  expect(stl).toHaveAttribute('title', 'Fix the error first, so the file matches the code')
  expect(screen.getByRole('button', { name: 'Export .scad' })).toBeEnabled()
  expect(screen.getByTestId('dims')).toHaveTextContent('20 × 20 × 10 mm')
  expect(screen.getByTestId('viewer')).toHaveAttribute('data-stale', 'true')
  expect(screen.getByTestId('console')).toHaveTextContent('ERROR: Parser error')
  expect(screen.getByTestId('console')).toHaveTextContent('OpenSCAD exited with code 1 · 5 ms')
  expect(container.querySelector('.cm-diag-callout')).toHaveTextContent('Line 1: Parser error: syntax error')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('clicking the failed status pill selects the error line in the editor', async () => {
  const { container } = render(
    <App createWorker={scriptedWorker((req) => (req.code.includes('broken') ? errorResult() : okResult()))} />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled())
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'cube(1);\nbroken(' }, selection: { anchor: 0 } })
  const pill = await screen.findByRole('button', { name: 'Failed · line 1' }, { timeout: 3_000 })
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  await userEvent.click(pill)
  expect(view.state.selection.main.head).toBe(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run build src/App.test.tsx`
Expected: FAIL, because `./csp` can't be resolved and `App` doesn't accept `createWorker` or render the new UI.

- [ ] **Step 3: Implement the CSP plugin and App**

`build/csp.ts`:

```ts
import type { Plugin } from 'vite'

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  // CodeMirror injects <style> elements at runtime.
  "style-src 'self' 'unsafe-inline'",
  // Archivo and JetBrains Mono are bundled from fontsource; no font CDN.
  "font-src 'self'",
  "img-src 'self' data: blob:",
  // AI providers (M2) are arbitrary https endpoints; local model servers run on localhost.
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

export function cspPlugin(): Plugin {
  return {
    name: 'promptcad-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`),
  }
}
```

In `vite.config.ts`, add the import and the plugin:

```ts
import { cspPlugin } from './build/csp'
// …
  plugins: [react(), tailwindcss(), cspPlugin()],
```

Replace `src/App.tsx`:

```tsx
import { CodeEditor } from './editor/CodeEditor'
import { ExportButtons, exportDisabledReason } from './export/ExportButtons'
import { exportScad, exportStl } from './export/saveFile'
import { ConsolePanel } from './panels/ConsolePanel'
import { createRenderWorker, type WorkerFactory } from './render/createRenderWorker'
import { useRenderLoop } from './render/useRenderLoop'
import { selectCanExport, useAppStore } from './state/store'
import { DimsReadout } from './ui/DimsReadout'
import { StatusPill } from './ui/StatusPill'
import { Viewer } from './viewer/Viewer'

export function App({ createWorker = createRenderWorker }: { createWorker?: WorkerFactory }) {
  useRenderLoop(createWorker)
  const code = useAppStore((s) => s.code)
  const setCode = useAppStore((s) => s.setCode)
  const goToLine = useAppStore((s) => s.goToLine)
  const reveal = useAppStore((s) => s.reveal)
  const status = useAppStore((s) => s.status)
  const mesh = useAppStore((s) => s.mesh)
  const logs = useAppStore((s) => s.logs)
  const diagnostics = useAppStore((s) => s.diagnostics)
  const error = useAppStore((s) => s.error)
  const renderMs = useAppStore((s) => s.renderMs)
  const canExportStl = useAppStore(selectCanExport)

  const bounds = mesh?.bounds ?? null
  const stale = status === 'error' && mesh !== null

  return (
    <div className="pc-root flex h-full flex-col bg-bg text-ink">
      <header className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-line bg-panel pl-4 pr-3">
        <h1 className="text-[15px] font-bold tracking-tight">PromptCAD</h1>
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        <StatusPill status={status} renderMs={renderMs} error={error} diagnostics={diagnostics} onGoToLine={goToLine} />
        {bounds && <DimsReadout bounds={bounds} />}
        {stale && <span className="pc-caption">last model that compiled</span>}
        <span className="flex-1" />
        <ExportButtons
          canExportStl={canExportStl}
          disabledReason={exportDisabledReason(status)}
          onExportStl={() => {
            const { stl } = useAppStore.getState()
            if (stl) void exportStl(stl)
          }}
          onExportScad={() => void exportScad(useAppStore.getState().code)}
        />
      </header>

      <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_440px] md:grid-rows-1">
        <section aria-label="3D view" className="min-h-0 min-w-0">
          <Viewer mesh={mesh} stale={stale} />
        </section>

        <section
          aria-label="Code"
          className="flex min-h-0 min-w-0 flex-col border-t border-line bg-panel md:border-t-0 md:border-l"
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
            <div className="pc-tabs" role="tablist">
              <button type="button" role="tab" aria-selected="true" className="pc-tab">
                main.scad
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor value={code} onChange={setCode} diagnostics={diagnostics} reveal={reveal} />
          </div>
          <div className="h-44 shrink-0 border-t border-line">
            <ConsolePanel status={status} logs={logs} error={error} renderMs={renderMs} onGoToLine={goToLine} />
          </div>
        </section>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: all tests pass, and there are no type errors.

- [ ] **Step 5: Write the Playwright smoke test**

```bash
npm i -D @playwright/test
npx playwright install chromium
npm pkg set scripts.e2e="playwright test"
printf 'test-results/\nplaywright-report/\n' >> .gitignore
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:4173', acceptDownloads: true },
  webServer: {
    // Production build, so the CSP meta tag is active during the test.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
```

`e2e/smoke.spec.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const RENDER_TIMEOUT = 90_000

function watchCspViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) violations.push(msg.text())
  })
  return violations
}

async function replaceCode(page: Page, code: string) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  // insertText avoids CodeMirror auto-closing brackets that would double up with typed input.
  await page.keyboard.insertText(code)
}

test('renders the default model in the real OpenSCAD WASM and exports binary STL', async ({ page }) => {
  const csp = watchCspViolations(page)
  await page.goto('/')
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('render-status')).toHaveText(/^Rendered \d+ ms$/)
  await expect(page.getByTestId('dims-axes')).toHaveAttribute('aria-label', '20 × 20 × 10 mm')
  await expect(page.locator('canvas')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export STL' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('model.stl')
  const bytes = await readFile((await download.path())!)
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50)

  expect(csp).toEqual([])
})

test('pasted code re-renders with new dimensions', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await replaceCode(page, 'cube([30, 10, 5]);')
  await expect(page.getByTestId('dims')).toHaveText('30 × 10 × 5 mm', { timeout: RENDER_TIMEOUT })
})

test('a compile error shows the pill, gutter and inline callout, keeps the last mesh, and blocks STL export', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await replaceCode(page, 'cube([10, 10, 10]')
  await expect(page.getByTestId('render-status')).toHaveText(/^Failed · line \d+$/, { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('console')).toContainText('ERROR')
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible()
  await expect(page.locator('.cm-diag-callout')).toContainText(/^Line \d+: /)
  await expect(page.getByText('Showing the last model that compiled')).toBeVisible()
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm')
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('follows the system colour scheme with the light theme as a full peer', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 241, 244)') // bg (light)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 16, 21)') // bg (dark)
})
```

- [ ] **Step 6: Run the end-to-end tests**

Run: `npm run e2e`
Expected: 4 tests pass. If they fail:
- **CSP violation in the console**: report the exact directive and do not loosen `script-src` silently. The spec fixes it at `'self' 'wasm-unsafe-eval'`. A `font-src` violation means a font is being loaded from a URL instead of the bundle; check that `main.tsx` imports the fontsource packages and nothing imports the Google Fonts URL (the design system's `bundle.css` had one; `design/components.css` must not).
- **`Unknown option --backend`** in the console: the downloaded snapshot predates Manifold-as-backend. Re-run `npm run fetch:openscad` (without `--if-missing`) to get a newer one, or pin `OPENSCAD_WASM_URL`.
- **Worker fails to import `/openscad/openscad.js`**: confirm Task 3 Step 5's ES module check.
- **Light theme colour mismatch**: `src/styles/tokens.css` is stale; run `npm run tokens` (the unit test for this would also be failing).

- [ ] **Step 7: Manual check in dev**

Run: `npm run dev` and open the printed URL.
Check against the Workbench and Compile error screens:
- Header: wordmark, separator, pill "Rendered N ms" in the `ok` tone with a check icon, dims "20 × 20 × 10 mm" in mono, "Export .scad" and the single primary "Export STL" on the right.
- Viewer: dark `viewport` ground, grid with 10 mm sections, RGB axes, the model in filament orange, the axis dims top-left, "Fit view" top-right, "N triangles" bottom-left, gizmo bottom-right.
- Orbit, then edit `width = 40;`: the model updates after about 0.6 s **without the camera jumping**, and "Fit view" re-frames it.
- Delete a `)`: the pill becomes "Failed · line N" in the `error` tone, that editor line gets the `error-soft` ground, red line number and callout under it, the console shows the ERROR line in red and a muted "OpenSCAD exited with code 1 · N ms", the model dims under "Showing the last model that compiled", Export STL is disabled with its tooltip. Clicking the pill or the console ERROR line moves the cursor to that line.
- Switch the OS to light mode (or add `data-theme="light"` on `<html>` in devtools): every surface, the editor colours, the grid and the model follow.
- Keyboard: Tab through the header; each control shows the 2px accent focus ring with a gap.

- [ ] **Step 8: Commit**

```bash
git add build vite.config.ts src/App.tsx src/App.test.tsx playwright.config.ts e2e package.json package-lock.json .gitignore
git commit -m "feat: wire M1 workbench (header, viewer, editor, console, export), production CSP, Playwright smoke tests"
```

---

## Deferred from M1 (tracked for later plans)

Each item is part of the spec or the screens but belongs to a later milestone. M1's interfaces already leave room for it:

| Item | Milestone | Hook left in M1 |
| --- | --- | --- |
| Chat column (360px, left), composer, messages, cost caption | M2 | The workbench grid gains a first column; `StatusPill`, `DimsReadout`, `pc-*` classes are shared |
| Provider profiles, settings button, auto-fix, cost tracking | M2 | `RenderController` is the single render path the chat will call; "Failed · line N" pill text feeds the auto-fix callout |
| Project name button in the header, "v3 · edited by slider" caption, History button, "from v3" next to dims | M3 | Header is a flex row with a spacer; `stale` already marks "last model that compiled" |
| Customizer dock under the viewer (`pc-param`, presets, Bake), `-D` overrides | M3 | `RenderRequest.params` → `buildArgs` already emits `-D`; tree-sitter decision for the editor grammar |
| "Problems N" tab next to "main.scad" | M3 | `diagnostics` are in the store; the pane head is already a `pc-tabs` tablist |
| Theme setting (dark / light / system) | M3 | `tokens.css` honours `data-theme` on `<html>`; `useTokens` already observes it |
| Configurable debounce/timeout in `settings` | M3 | `useRenderLoop(createWorker, debounceMs, timeoutMs)` |
| Bundled libraries (BOSL2, MCAD) and fonts for `text()` | M3 | `runOpenSCAD` is the one place that writes the virtual FS |
| Export dialog (Model file / Image / Turntable / Timelapse / Link), Share button, PNG and GIF | M4 | `saveFile` is shared by every export; `ExportButtons` becomes the dialog's trigger |
| OpenSCAD download progress ("Loading OpenSCAD 5.2 / 8.4 MB"), offline caching, update prompt | M4 (PWA) | `StatusPill` idle state and the console's idle line are the two places that show it |
| Phone layout: Chat / Code / 3D `pc-tabbar`, 44px viewer buttons, symbol key row, parameter sheet | M4 | Under `md` the viewer and code already stack; `components.css` has `pc-tabbar` and the coarse-pointer sizes |
| Voice prompts, variants, URL share | M4 | `saveFile`; the `pc-variant` card exists in `components.css` |
| Per-face colour preview format, tag-colour picking (`pick` token), scoped edits | M5 | `parseStl` sits behind `MeshData`; a coloured-mesh parser can replace it |
| Low-`$fn` preview pass, triangle-count warning callout | M4 (mobile perf) | `MeshData.triangleCount` is already shown bottom-left in the viewer |
| OpenSCAD version in the console head ("OpenSCAD 2025.03 · manifold") | M3 | The console head caption is one string; the worker can report the version alongside the result |
