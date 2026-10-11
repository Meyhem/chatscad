# PromptCAD M1 — Render Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite + React (TSX) app where you paste OpenSCAD into a CodeMirror editor, it compiles in a Web Worker with OpenSCAD WASM (Manifold backend), the mesh shows in a three.js viewer with mm dimensions, and you can download binary STL and the `.scad` source.

**Architecture:** All work is client-side. A single `RenderController` is the only path to the render worker; it owns debounce (600 ms), cancellation (a newer request terminates the in-flight worker) and the 60 s timeout. The worker (Comlink) creates a fresh OpenSCAD WASM instance per render, writes `/main.scad`, runs `callMain`, parses the binary STL into typed arrays and transfers them back. A Zustand store holds code, render status, the last good mesh/STL, logs and diagnostics; React components (`.tsx`) render from it.

**Tech Stack:** Vite, React 19, TypeScript (strict, `.tsx` components), Tailwind CSS v4 (`@tailwindcss/vite`), Zustand, Comlink, CodeMirror 6, three.js via `@react-three/fiber` + `@react-three/drei`, OpenSCAD WASM (official WebAssembly snapshot build), Vitest + Testing Library (jsdom), Playwright, `tsx` for Node scripts, `fflate` for unzipping.

**Spec:** [`docs/SPEC.md`](../../SPEC.md). This plan implements Milestone 1 ("Render core") plus the cross-cutting rules from "Rendering pipeline", "Security" and "Tech stack" that M1 code touches.

## Global Constraints

- No backend: the build output is static files only ("nothing needs a server beyond static hosting").
- TypeScript `strict`; every React component is a `.tsx` file; Node scripts are `.ts` run with `tsx`.
- Rendering: "OpenSCAD WASM in a Web Worker", compile "with `--backend=manifold`, parameter overrides as `-D name=value`".
- "Each render runs in a dedicated Web Worker with a fresh OpenSCAD WASM instance, so a hung or crashed compile is killed by terminating the worker."
- Editor changes are "debounced ~600 ms, configurable. A newer request cancels the in-flight one."
- "Default timeout 60 s (setting)." "Last good mesh stays on screen when a compile fails."
- Display: "auto-fit camera on first render, keep the camera on re-renders, show bounding-box dimensions in mm." OpenSCAD is Z-up.
- Report: "stdout/stderr, warnings, `echo()` output and render time to a console panel; map error line numbers back into the editor as diagnostics."
- Export: "STL (binary) is the v1 target"; ".scad source" too. "On mobile, use the Web Share API with a file, falling back to a download link."
- Security: "`script-src 'self' 'wasm-unsafe-eval'`" … "No analytics, no CDN scripts." All assets (including the OpenSCAD WASM) are self-hosted under `/openscad/`. Do not use drei helpers that fetch from a CDN (`Environment` presets, remote fonts).
- "Model output is untrusted. Generated code only ever runs inside the OpenSCAD WASM sandbox; never `eval`, never rendered as HTML." Console text is rendered as React text nodes only.
- Units are millimetres.

## Review Focus

1. **Runaway model** (`for (i=[0:1e9]) cube(1);`, `$fn=1e6`). Expected: after 60 s the render stops, the console says it timed out, the last good mesh stays, and the next edit renders normally in a new worker. *Pinned in Task 6 (timeout test) and Task 6 (respawn test).*
2. **Fast typing.** Expected: only the latest code's result is ever shown, and a slow older result arriving late is discarded. *Pinned in Task 6 (stale-result test).*
3. **Code that produces no geometry** (empty file, only comments, `echo("hi");`). Expected: a plain "produced no output / model is empty" message with no crash, and the last mesh stays. *Pinned in Task 5 (no-output and zero-triangle tests) and Task 7 (store keeps mesh).*
4. **Export while the code is broken or still rendering.** Expected: Export STL is disabled, so you never download geometry that doesn't match the code in the editor. Export .scad stays enabled. *Pinned in Task 7 (`selectCanExport`) and Task 12 (App test).*
5. **HTML-looking text in model output** (`echo("<img src=x onerror=alert(1)>")`). Expected: it shows as literal text in the console and no element is created. *Pinned in Task 10 (ConsolePanel test).*

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, playwright.config.ts
build/csp.ts                     Vite plugin: inject CSP <meta> into production HTML
build/csp.test.ts
scripts/fetch-openscad.ts        tsx script: download OpenSCAD WASM into public/openscad/
scripts/fetch-openscad.test.ts
public/openscad/                 (git-ignored) openscad.js, openscad.wasm, VERSION
src/main.tsx                     React entry
src/App.tsx                      layout + wiring
src/App.test.tsx
src/index.css                    Tailwind import + full-height root
src/test/setup.ts                jest-dom matchers, jsdom shims for CodeMirror
src/test/stl.ts                  STL fixture builders (shared by tests)
src/test/results.ts              RenderResult fixtures (shared by tests)
src/render/types.ts              RenderRequest, RenderResult, MeshData, Bounds, LogLine, Diagnostic, ParamValue
src/render/result.ts             failedResult(), errorMessage()
src/render/args.ts               buildArgs(), formatParamValue(), INPUT_PATH, OUTPUT_PATH
src/render/diagnostics.ts        parseDiagnostics()
src/render/stl.ts                parseStl()
src/render/dims.ts               formatDims()
src/render/runOpenSCAD.ts        one compile against an injected OpenSCAD factory (pure, testable)
src/render/render.worker.ts      Comlink glue: loads /openscad/openscad.js, calls runOpenSCAD
src/render/createRenderWorker.ts real WorkerFactory (new Worker + Comlink.wrap)
src/render/controller.ts         RenderController: debounce, cancel, timeout, respawn
src/render/useRenderLoop.ts      hook: store.code → controller → store
src/state/store.ts               Zustand store, DEFAULT_CODE, selectCanExport
src/editor/openscadLanguage.ts   CodeMirror StreamLanguage for OpenSCAD
src/editor/CodeEditor.tsx        CodeMirror wrapper + toCmDiagnostics()
src/viewer/geometry.ts           meshToGeometry()
src/viewer/cameraFit.ts          computeCameraFit()
src/viewer/Viewer.tsx            Canvas, grid, axes, model, orbit controls, Fit button
src/panels/ConsolePanel.tsx      log lines (text only)
src/panels/StatusBar.tsx         render status + dims
src/export/saveFile.ts           Web Share with file → download fallback
src/export/ExportButtons.tsx     Export STL / Export .scad buttons
e2e/smoke.spec.ts                Playwright: real WASM, production build, CSP on
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

Run from the repo root (it already has `README.md`, `docs/` and `.gitignore`):

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

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>PromptCAD</title>
  </head>
  <body class="bg-neutral-950 text-neutral-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/index.css`:

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
      <header className="border-b border-neutral-800 px-3 py-2">
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

### Task 2: OpenSCAD WASM fetch script (run with tsx)

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
Expected: `1` or more. If it is `0`, stop and report: the worker in Task 5 imports it as an ES module.

- [ ] **Step 6: Commit**

```bash
git add scripts package.json package-lock.json .gitignore
git commit -m "build: fetch OpenSCAD WASM snapshot into public/openscad via tsx script"
```

---

### Task 3: Render types, OpenSCAD arguments and diagnostics parsing

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
  - `parseDiagnostics(logs: LogLine[]): Diagnostic[]`
  - `failedResult(error: string, opts?: { logs?: LogLine[]; renderMs?: number }): RenderResult`
  - `errorMessage(e: unknown): string`

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
import { parseDiagnostics } from './diagnostics'
import type { LogLine } from './types'

const err = (text: string): LogLine => ({ stream: 'stderr', text })

it('maps parser errors in main.scad to a line', () => {
  expect(parseDiagnostics([err('ERROR: Parser error in file "/main.scad", line 3: syntax error')])).toEqual([
    { severity: 'error', line: 3, message: 'Parser error in file "/main.scad", line 3: syntax error' },
  ])
})

it('maps warnings with an unquoted file name', () => {
  expect(parseDiagnostics([err("WARNING: Ignoring unknown variable 'x' in file main.scad, line 2")])).toEqual([
    { severity: 'warning', line: 2, message: "Ignoring unknown variable 'x' in file main.scad, line 2" },
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
const LOCATION = /in file\s+"?([^",]+?)"?,\s*line\s+(\d+)/

export function parseDiagnostics(logs: LogLine[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const { text } of logs) {
    const m = PREFIX.exec(text.trim())
    if (!m) continue
    const loc = LOCATION.exec(m[2])
    if (!loc || !/(^|\/)main\.scad$/.test(loc[1])) continue
    out.push({ severity: m[1] === 'ERROR' ? 'error' : 'warning', line: Number(loc[2]), message: m[2] })
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
Expected: PASS (8 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/render
git commit -m "feat(render): request/result types, OpenSCAD args and diagnostics parser"
```

---

### Task 4: STL parsing and dimensions

**Files:**
- Create: `src/render/stl.ts`, `src/render/dims.ts`, `src/test/stl.ts`
- Test: `src/render/stl.test.ts`, `src/render/dims.test.ts`

**Interfaces:**
- Consumes: `MeshData`, `Bounds`, `Vec3` from `src/render/types.ts`.
- Produces:
  - `parseStl(buffer: ArrayBuffer): MeshData`, which accepts binary and ASCII STL and throws `'Unrecognised STL data'` / `'Malformed ASCII STL'`
  - `formatDims(bounds: Bounds): string`, for example `"20 × 20 × 10 mm"`
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
import { formatDims } from './dims'

it('formats bounding box size in mm', () => {
  expect(formatDims({ min: [0, 0, 0], max: [20, 20, 10] })).toBe('20 × 20 × 10 mm')
})

it('rounds to two decimals and trims zeros', () => {
  expect(formatDims({ min: [-1, 0, 0], max: [1.5, 0.333333, 2] })).toBe('2.5 × 0.33 × 2 mm')
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

export function formatDims({ min, max }: Bounds): string {
  return `${fmt(max[0] - min[0])} × ${fmt(max[1] - min[1])} × ${fmt(max[2] - min[2])} mm`
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

### Task 5: One OpenSCAD compile (`runOpenSCAD`) and the Comlink worker

**Files:**
- Create: `src/render/runOpenSCAD.ts`, `src/render/render.worker.ts`, `src/render/createRenderWorker.ts`
- Test: `src/render/runOpenSCAD.test.ts`

**Interfaces:**
- Consumes: `buildArgs`, `INPUT_PATH`, `OUTPUT_PATH` (Task 3); `parseStl` (Task 4); `failedResult`, `errorMessage` (Task 3); `parseDiagnostics` (Task 3); `binaryStl`, `BOX_TRI` (test helpers, Task 4).
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

`src/render/render.worker.ts`. This file is thin glue and is exercised by the Playwright test in Task 12:

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

### Task 6: RenderController (debounce, cancel, timeout, respawn)

**Files:**
- Create: `src/render/controller.ts`, `src/test/results.ts`
- Test: `src/render/controller.test.ts`

**Interfaces:**
- Consumes: `RenderWorkerHandle`, `WorkerFactory` (Task 5); `failedResult`, `errorMessage` (Task 3); `parseStl` (Task 4); `binaryStl`, `BOX_TRI` (Task 4 test helpers).
- Produces:
  - `DEFAULT_DEBOUNCE_MS = 600`, `DEFAULT_TIMEOUT_MS = 60_000`
  - `interface RenderControllerOptions { createWorker: WorkerFactory; onResult(result: RenderResult): void; onStart?(): void; debounceMs?: number; timeoutMs?: number }`
  - `class RenderController { constructor(opts: RenderControllerOptions); request(req: RenderRequest, opts?: { immediate?: boolean }): void; cancel(): void; dispose(): void }`
  - Test helper `okResult(): RenderResult` (the 20×20×10 mesh) and `errorResult(message?: string): RenderResult`

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

### Task 7: App store and render loop hook

**Files:**
- Create: `src/state/store.ts`, `src/render/useRenderLoop.ts`
- Test: `src/state/store.test.ts`, `src/render/useRenderLoop.test.ts`

**Interfaces:**
- Consumes: `RenderController`, `DEFAULT_DEBOUNCE_MS`, `DEFAULT_TIMEOUT_MS` (Task 6); `WorkerFactory`, `createRenderWorker` (Task 5); `okResult`, `errorResult` (Task 6 helpers).
- Produces:
  - `type RenderStatus = 'idle' | 'rendering' | 'ok' | 'error'`
  - `interface AppState { code; status; mesh: MeshData | null; stl: ArrayBuffer | null; logs; diagnostics; error: string | null; renderMs: number | null; setCode(code: string): void; renderStarted(): void; renderFinished(result: RenderResult): void }`
  - `useAppStore` (Zustand hook; also `.getState()`, `.setState()`, `.subscribe()`, `.getInitialState()`)
  - `DEFAULT_CODE: string` (renders to 20 × 20 × 10 mm)
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

export const DEFAULT_CODE = `// PromptCAD: edit me
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
  setCode(code: string): void
  renderStarted(): void
  renderFinished(result: RenderResult): void
}

export const useAppStore = create<AppState>()((set) => ({
  code: DEFAULT_CODE,
  status: 'idle',
  mesh: null,
  stl: null,
  logs: [],
  diagnostics: [],
  error: null,
  renderMs: null,
  setCode: (code) => set({ code }),
  renderStarted: () => set({ status: 'rendering' }),
  renderFinished: (r) =>
    set(
      r.ok
        ? { status: 'ok', mesh: r.mesh, stl: r.stl, error: null, logs: r.logs, diagnostics: r.diagnostics, renderMs: r.renderMs }
        : { status: 'error', error: r.error, logs: r.logs, diagnostics: r.diagnostics, renderMs: r.renderMs },
    ),
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
git commit -m "feat(state): Zustand app store, export guard, and render loop hook"
```

---

### Task 8: CodeMirror editor with OpenSCAD highlighting and diagnostics

**Files:**
- Create: `src/editor/openscadLanguage.ts`, `src/editor/CodeEditor.tsx`
- Test: `src/editor/openscadLanguage.test.ts`, `src/editor/CodeEditor.test.tsx`

**Interfaces:**
- Consumes: `Diagnostic` (Task 3).
- Produces:
  - `openscadParser: StreamParser<{ inComment: boolean }>` and `openscad(): StreamLanguage<…>`
  - `toCmDiagnostics(doc: Text, diagnostics: Diagnostic[]): CmDiagnostic[]`, which clamps out-of-range lines into the document
  - `<CodeEditor value={string} onChange={(code: string) => void} diagnostics={Diagnostic[]} />`, which renders `data-testid="code-editor"`

This uses a hand-written grammar for now. The spec's open question about reusing tree-sitter is decided in M3, when tree-sitter arrives for Customizer parsing.

- [ ] **Step 1: Install CodeMirror**

```bash
npm i codemirror @codemirror/state @codemirror/view @codemirror/language @codemirror/lint @codemirror/theme-one-dark
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

`src/editor/CodeEditor.test.tsx`:

```tsx
import { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
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

describe('toCmDiagnostics', () => {
  const doc = Text.of(['cube(1);', 'sphere(', 'x'])
  it('spans the whole reported line', () => {
    expect(toCmDiagnostics(doc, [{ line: 2, severity: 'error', message: 'syntax error' }])).toEqual([
      { from: 9, to: 16, severity: 'error', message: 'syntax error' },
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

- [ ] **Step 4: Implement**

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

`src/editor/CodeEditor.tsx`:

```tsx
import { EditorState, type Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import type { Diagnostic } from '../render/types'
import { openscad } from './openscadLanguage'

export function toCmDiagnostics(doc: Text, diagnostics: Diagnostic[]): CmDiagnostic[] {
  return diagnostics.map((d) => {
    const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines))
    return { from: line.from, to: line.to, severity: d.severity, message: d.message }
  })
}

interface Props {
  value: string
  onChange(code: string): void
  diagnostics: Diagnostic[]
}

export function CodeEditor({ value, onChange, diagnostics }: Props) {
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
          oneDark,
          lintGutter(),
          EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
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
    if (view) view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state.doc, diagnostics)))
  }, [diagnostics])

  return <div ref={hostRef} className="h-full min-h-0" data-testid="code-editor" />
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: PASS, no type errors. If `StringStream`'s constructor signature differs in the installed version, check `node_modules/@codemirror/language/dist/index.d.ts` and adjust the test helper to match. Do not change the parser for this.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/editor
git commit -m "feat(editor): CodeMirror 6 editor with OpenSCAD highlighting and lint diagnostics"
```

---

### Task 9: three.js viewer (geometry, camera fit, Z-up scene)

**Files:**
- Create: `src/viewer/geometry.ts`, `src/viewer/cameraFit.ts`, `src/viewer/Viewer.tsx`
- Test: `src/viewer/geometry.test.ts`, `src/viewer/cameraFit.test.ts`

**Interfaces:**
- Consumes: `MeshData`, `Bounds`, `Vec3` (Task 3); `parseStl` and test helpers (Task 4).
- Produces:
  - `meshToGeometry(mesh: MeshData): BufferGeometry`
  - `interface CameraFit { position: Vec3; target: Vec3; distance: number }` and `computeCameraFit(bounds: Bounds, fovDeg: number, aspect: number, margin?: number): CameraFit`
  - `<Viewer mesh={MeshData | null} />`, which renders `data-testid="viewer"` with a `<canvas>` and a "Fit view" button

`<Viewer>` needs WebGL, so jsdom can't render it. Its pure parts are unit-tested here, and the component is covered by Playwright in Task 12.

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
import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Object3D, type PerspectiveCamera, type Vector3 } from 'three'
import type { Bounds, MeshData } from '../render/types'
import { computeCameraFit } from './cameraFit'
import { meshToGeometry } from './geometry'

// OpenSCAD is Z-up. This must run before any camera or controls are created.
Object3D.DEFAULT_UP.set(0, 0, 1)

function Model({ mesh }: { mesh: MeshData }) {
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#f59e0b" roughness={0.6} metalness={0.1} />
    </mesh>
  )
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

export function Viewer({ mesh }: { mesh: MeshData | null }) {
  const [fitToken, setFitToken] = useState(0)
  return (
    <div className="relative h-full w-full" data-testid="viewer">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 45, near: 0.1, far: 10_000, position: [60, -80, 60] }}>
        <color attach="background" args={['#0a0a0a']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, -80, 100]} intensity={1.4} />
        <directionalLight position={[-60, 40, -30]} intensity={0.4} />
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          infiniteGrid
          cellSize={1}
          sectionSize={10}
          cellColor="#262626"
          sectionColor="#404040"
          fadeDistance={400}
        />
        <axesHelper args={[20]} />
        {mesh && <Model mesh={mesh} />}
        <OrbitControls makeDefault />
        <CameraFitter bounds={mesh?.bounds ?? null} fitToken={fitToken} />
      </Canvas>
      <button
        type="button"
        className="absolute right-2 top-2 rounded bg-neutral-800/80 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40"
        onClick={() => setFitToken((t) => t + 1)}
        disabled={!mesh}
      >
        Fit view
      </button>
    </div>
  )
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck && npm test`
Expected: no type errors, and all tests pass.

```bash
git add package.json package-lock.json src/viewer
git commit -m "feat(viewer): Z-up three.js viewer with first-render auto-fit and Fit view"
```

---

### Task 10: Console panel and status bar

**Files:**
- Create: `src/panels/ConsolePanel.tsx`, `src/panels/StatusBar.tsx`
- Test: `src/panels/ConsolePanel.test.tsx`, `src/panels/StatusBar.test.tsx`

**Interfaces:**
- Consumes: `LogLine`, `Bounds` (Task 3); `formatDims` (Task 4); `RenderStatus` (Task 7).
- Produces:
  - `<ConsolePanel logs={LogLine[]} error={string | null} />`, which renders `data-testid="console"`
  - `<StatusBar status={RenderStatus} renderMs={number | null} error={string | null} bounds={Bounds | null} />`, which renders `data-testid="render-status"` and `data-testid="dims"`

- [ ] **Step 1: Write the failing tests**

`src/panels/ConsolePanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { ConsolePanel } from './ConsolePanel'

it('shows the error first, then every log line', () => {
  render(
    <ConsolePanel
      error="OpenSCAD exited with code 1"
      logs={[
        { stream: 'stdout', text: 'ECHO: 42' },
        { stream: 'stderr', text: 'WARNING: unknown variable' },
        { stream: 'stderr', text: 'ERROR: Parser error' },
      ]}
    />,
  )
  const lines = screen.getByTestId('console').children
  expect(Array.from(lines).map((l) => l.textContent)).toEqual([
    'OpenSCAD exited with code 1',
    'ECHO: 42',
    'WARNING: unknown variable',
    'ERROR: Parser error',
  ])
})

it('colours errors and warnings', () => {
  render(
    <ConsolePanel
      error={null}
      logs={[
        { stream: 'stderr', text: 'ERROR: bad' },
        { stream: 'stderr', text: 'WARNING: meh' },
      ]}
    />,
  )
  expect(screen.getByText('ERROR: bad')).toHaveClass('text-red-400')
  expect(screen.getByText('WARNING: meh')).toHaveClass('text-amber-400')
})

it('renders model output as plain text, never as HTML', () => {
  const evil = 'ECHO: "<img src=x onerror=alert(1)>"'
  render(<ConsolePanel error={null} logs={[{ stream: 'stdout', text: evil }]} />)
  expect(screen.getByText(evil)).toBeInTheDocument()
  expect(screen.getByTestId('console').querySelector('img')).toBeNull()
})
```

`src/panels/StatusBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { StatusBar } from './StatusBar'

const box = { min: [0, 0, 0] as [number, number, number], max: [20, 20, 10] as [number, number, number] }

it('says OpenSCAD is loading before the first render', () => {
  render(<StatusBar status="idle" renderMs={null} error={null} bounds={null} />)
  expect(screen.getByTestId('render-status')).toHaveTextContent('Loading OpenSCAD…')
  expect(screen.queryByTestId('dims')).toBeNull()
})

it('shows render time and dimensions after success', () => {
  render(<StatusBar status="ok" renderMs={123.4} error={null} bounds={box} />)
  expect(screen.getByTestId('render-status')).toHaveTextContent('Rendered in 123 ms')
  expect(screen.getByTestId('dims')).toHaveTextContent('20 × 20 × 10 mm')
})

it('shows rendering state', () => {
  render(<StatusBar status="rendering" renderMs={null} error={null} bounds={box} />)
  expect(screen.getByTestId('render-status')).toHaveTextContent('Rendering…')
})

it('shows failure with the error as a tooltip and keeps the last dims', () => {
  render(<StatusBar status="error" renderMs={5} error="Render timed out after 60 s" bounds={box} />)
  const status = screen.getByTestId('render-status')
  expect(status).toHaveTextContent('Render failed')
  expect(status).toHaveAttribute('title', 'Render timed out after 60 s')
  expect(screen.getByTestId('dims')).toHaveTextContent('20 × 20 × 10 mm')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/panels`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 3: Implement**

`src/panels/ConsolePanel.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { LogLine } from '../render/types'

function lineClass({ stream, text }: LogLine): string {
  if (text.startsWith('ERROR')) return 'text-red-400'
  if (text.startsWith('WARNING')) return 'text-amber-400'
  return stream === 'stderr' ? 'text-neutral-400' : 'text-neutral-200'
}

export function ConsolePanel({ logs, error }: { logs: LogLine[]; error: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs, error])

  return (
    <div
      ref={ref}
      data-testid="console"
      aria-label="Console"
      className="h-full overflow-auto whitespace-pre-wrap bg-neutral-900 p-2 font-mono text-xs"
    >
      {error && <div className="text-red-400">{error}</div>}
      {logs.map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line.text}
        </div>
      ))}
    </div>
  )
}
```

`src/panels/StatusBar.tsx`:

```tsx
import { formatDims } from '../render/dims'
import type { Bounds } from '../render/types'
import type { RenderStatus } from '../state/store'

interface Props {
  status: RenderStatus
  renderMs: number | null
  error: string | null
  bounds: Bounds | null
}

function label(status: RenderStatus, renderMs: number | null): string {
  switch (status) {
    case 'idle':
      return 'Loading OpenSCAD…'
    case 'rendering':
      return 'Rendering…'
    case 'ok':
      return `Rendered in ${Math.round(renderMs ?? 0)} ms`
    case 'error':
      return 'Render failed'
  }
}

export function StatusBar({ status, renderMs, error, bounds }: Props) {
  return (
    <div className="flex items-center gap-3 text-sm" role="status">
      <span
        data-testid="render-status"
        title={status === 'error' ? (error ?? undefined) : undefined}
        className={status === 'error' ? 'text-red-400' : 'text-neutral-400'}
      >
        {label(status, renderMs)}
      </span>
      {bounds && (
        <span data-testid="dims" className="tabular-nums text-neutral-200">
          {formatDims(bounds)}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/panels && npm run typecheck`
Expected: PASS (7 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/panels
git commit -m "feat(panels): console panel (text-only output) and render status bar with dims"
```

---

### Task 11: STL and .scad export (Web Share with download fallback)

**Files:**
- Create: `src/export/saveFile.ts`, `src/export/ExportButtons.tsx`
- Test: `src/export/saveFile.test.ts`, `src/export/ExportButtons.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (presentational plus browser APIs).
- Produces:
  - `type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'`
  - `saveFile(blob: Blob, filename: string, opts?: { preferShare?: boolean }): Promise<SaveOutcome>`, where `preferShare` defaults to `true` on coarse-pointer (touch) devices
  - `exportStl(stl: ArrayBuffer): Promise<SaveOutcome>` saves `model.stl` (`model/stl`), and `exportScad(code: string): Promise<SaveOutcome>` saves `model.scad` (`text/plain`)
  - `<ExportButtons canExportStl={boolean} onExportStl={() => void} onExportScad={() => void} />`, with buttons named "Export STL" and "Export .scad"

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
import { ExportButtons } from './ExportButtons'

it('disables STL export when there is no matching render, but keeps .scad export available', () => {
  render(<ExportButtons canExportStl={false} onExportStl={() => {}} onExportScad={() => {}} />)
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Export .scad' })).toBeEnabled()
})

it('calls the handlers', async () => {
  const onExportStl = vi.fn()
  const onExportScad = vi.fn()
  render(<ExportButtons canExportStl onExportStl={onExportStl} onExportScad={onExportScad} />)
  await userEvent.click(screen.getByRole('button', { name: 'Export STL' }))
  await userEvent.click(screen.getByRole('button', { name: 'Export .scad' }))
  expect(onExportStl).toHaveBeenCalledOnce()
  expect(onExportScad).toHaveBeenCalledOnce()
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
interface Props {
  canExportStl: boolean
  onExportStl(): void
  onExportScad(): void
}

const button = 'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40'

export function ExportButtons({ canExportStl, onExportStl, onExportScad }: Props) {
  return (
    <div className="flex gap-2">
      <button type="button" className={button} disabled={!canExportStl} onClick={onExportStl}>
        Export STL
      </button>
      <button type="button" className={button} onClick={onExportScad}>
        Export .scad
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/export && npm run typecheck`
Expected: PASS (6 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/export
git commit -m "feat(export): STL and .scad export with Web Share on touch devices and download fallback"
```

---

### Task 12: App wiring, production CSP, and end-to-end smoke test

**Files:**
- Create: `build/csp.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `src/App.tsx`, `src/App.test.tsx`, `vite.config.ts`, `.gitignore`, `package.json`
- Test: `build/csp.test.ts`, `src/App.test.tsx`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: every earlier module: `useAppStore`, `selectCanExport`, `useRenderLoop`, `WorkerFactory`, `createRenderWorker`, `CodeEditor`, `Viewer`, `ConsolePanel`, `StatusBar`, `ExportButtons`, `exportStl`, `exportScad`.
- Produces:
  - `<App createWorker?={WorkerFactory} />`, where the default is the real worker and tests inject a fake
  - `CSP: string` and `cspPlugin(): Plugin` (build only: Vite dev needs inline scripts for React Refresh)
  - npm script `e2e`

- [ ] **Step 1: Write the failing tests (CSP plugin and App)**

`build/csp.test.ts`:

```ts
import type { Plugin } from 'vite'
import { CSP, cspPlugin } from './csp'

it('allows only self-hosted scripts plus WASM compilation', () => {
  expect(CSP).toContain("script-src 'self' 'wasm-unsafe-eval'")
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
import type { RenderWorkerHandle } from './render/createRenderWorker'
import type { RenderRequest, RenderResult } from './render/types'
import { useAppStore } from './state/store'
import { errorResult, okResult } from './test/results'
import { App } from './App'

vi.mock('./viewer/Viewer', () => ({ Viewer: () => <div data-testid="viewer" /> }))

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

function scriptedWorker(respond: (req: RenderRequest) => RenderResult) {
  const handle: RenderWorkerHandle = { render: async (req) => respond(req), terminate: () => {} }
  return () => handle
}

it('renders the default model and enables STL export', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('heading', { name: 'PromptCAD' })).toBeInTheDocument()
  expect(screen.getByTestId('viewer')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('dims')).toHaveTextContent('20 × 20 × 10 mm'))
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled()
})

it('keeps the last mesh but disables STL export after a failed edit', async () => {
  const { container } = render(
    <App createWorker={scriptedWorker((req) => (req.code.includes('broken') ? errorResult() : okResult()))} />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled())

  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'broken(' } })

  await waitFor(() => expect(screen.getByTestId('render-status')).toHaveTextContent('Render failed'), { timeout: 3_000 })
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Export .scad' })).toBeEnabled()
  expect(screen.getByTestId('dims')).toHaveTextContent('20 × 20 × 10 mm')
  expect(screen.getByTestId('console')).toHaveTextContent('ERROR: Parser error')
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
import { ExportButtons } from './export/ExportButtons'
import { exportScad, exportStl } from './export/saveFile'
import { ConsolePanel } from './panels/ConsolePanel'
import { StatusBar } from './panels/StatusBar'
import { createRenderWorker, type WorkerFactory } from './render/createRenderWorker'
import { useRenderLoop } from './render/useRenderLoop'
import { selectCanExport, useAppStore } from './state/store'
import { Viewer } from './viewer/Viewer'

export function App({ createWorker = createRenderWorker }: { createWorker?: WorkerFactory }) {
  useRenderLoop(createWorker)
  const code = useAppStore((s) => s.code)
  const setCode = useAppStore((s) => s.setCode)
  const status = useAppStore((s) => s.status)
  const mesh = useAppStore((s) => s.mesh)
  const logs = useAppStore((s) => s.logs)
  const diagnostics = useAppStore((s) => s.diagnostics)
  const error = useAppStore((s) => s.error)
  const renderMs = useAppStore((s) => s.renderMs)
  const canExportStl = useAppStore(selectCanExport)

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-3 py-2">
        <h1 className="font-semibold">PromptCAD</h1>
        <StatusBar status={status} renderMs={renderMs} error={error} bounds={mesh?.bounds ?? null} />
        <div className="ml-auto">
          <ExportButtons
            canExportStl={canExportStl}
            onExportStl={() => {
              const { stl } = useAppStore.getState()
              if (stl) void exportStl(stl)
            }}
            onExportScad={() => void exportScad(useAppStore.getState().code)}
          />
        </div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
        <section className="flex min-h-0 flex-col border-neutral-800 md:border-r">
          <div className="min-h-0 flex-1">
            <CodeEditor value={code} onChange={setCode} diagnostics={diagnostics} />
          </div>
          <div className="h-40 border-t border-neutral-800">
            <ConsolePanel logs={logs} error={error} />
          </div>
        </section>
        <section className="min-h-0">
          <Viewer mesh={mesh} />
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
  await expect(page.getByTestId('render-status')).toHaveText(/Rendered in \d+ ms/)
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

test('a compile error shows a diagnostic, keeps the last mesh, and blocks STL export', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await replaceCode(page, 'cube([10, 10, 10]')
  await expect(page.getByTestId('render-status')).toHaveText('Render failed', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('console')).toContainText('ERROR')
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible()
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm')
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeDisabled()
})
```

- [ ] **Step 6: Run the end-to-end tests**

Run: `npm run e2e`
Expected: 3 tests pass. If they fail:
- **CSP violation in the console**: report the exact directive and do not loosen `script-src` silently. The spec fixes it at `'self' 'wasm-unsafe-eval'`.
- **`Unknown option --backend`** in the console: the downloaded snapshot predates Manifold-as-backend. Re-run `npm run fetch:openscad` (without `--if-missing`) to get a newer one, or pin `OPENSCAD_WASM_URL`.
- **Worker fails to import `/openscad/openscad.js`**: confirm Task 2 Step 5's ES module check.

- [ ] **Step 7: Manual check in dev**

Run: `npm run dev` and open the printed URL.
Check that the model appears and is framed. Orbit the camera and edit `width = 40;`. The model should update after about 0.6 s **without the camera jumping**, and "Fit view" should re-frame it. Then `Export .scad` should download `model.scad`.

- [ ] **Step 8: Commit**

```bash
git add build vite.config.ts src/App.tsx src/App.test.tsx playwright.config.ts e2e package.json package-lock.json .gitignore
git commit -m "feat: wire M1 app (editor, viewer, console, export), production CSP, Playwright smoke tests"
```

---

## Deferred from M1 (tracked for later plans)

Each item is part of the spec but belongs to a later milestone. M1's interfaces already leave room for it:

| Item | Milestone | Hook left in M1 |
| --- | --- | --- |
| Provider profiles, chat, auto-fix, cost tracking | M2 | `RenderController` is the single render path the chat will call |
| Customizer sliders (`-D` overrides), presets, Dexie history, gallery | M3 | `RenderRequest.params` → `buildArgs` already emits `-D`; tree-sitter decision for the editor grammar |
| Configurable debounce/timeout in `settings` | M3 | `useRenderLoop(createWorker, debounceMs, timeoutMs)` |
| Bundled libraries (BOSL2, MCAD) and fonts for `text()` | M3 | `runOpenSCAD` is the one place that writes the virtual FS |
| Variants, URL share, PNG/GIF, PWA offline, phone tab layout, voice | M4 | `saveFile` is shared by every export |
| Per-face colour preview format, tag-colour picking, scoped edits | M5 | `parseStl` sits behind `MeshData`; a coloured-mesh parser can replace it |
| Low-`$fn` preview pass, triangle-count warning | M4 (mobile perf) | `MeshData.triangleCount` |
