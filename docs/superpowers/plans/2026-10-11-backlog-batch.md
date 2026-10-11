# Backlog batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six `docs/BACKLOG.md` items: title goes home, image export framing, animated turntable preview, empty new projects, resizable desktop panels, and a model picker with prices.

**Architecture:** Six independent changes on `main`, one commit (or a short series) each, in the order below. Each reuses existing stores (`useAppStore`, `usePrefs`, `useProvidersStore`), the `pc-*` classes and token utilities. No new dependencies.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind v4 token utilities, CodeMirror 6, react-three-fiber / three, Dexie (IndexedDB), Vitest + Testing Library (jsdom), Playwright against the real OpenSCAD WASM.

**Spec:** `docs/superpowers/specs/2026-10-11-backlog-batch-design.md` (visual reference: `Backlog*.dc.html` boards on https://claude.ai/artifact/TNXkMGKfbuVrEAh8MEvMDA).

## Global Constraints

- TDD: write the failing test first and watch it fail. Tests that read the filesystem start with `// @vitest-environment node`.
- Tokens only: no hex colours and no Tailwind palette classes in `src/`. Use `bg-panel`, `text-ink`, `border-line`, `bg-accent`, `bg-panel-raised`, the CSS variables and the `pc-*` classes.
- Copy: sentence case, units on every number, the `×` sign, errors say what failed and where, no exclamation marks or emoji.
- Model output is untrusted: React text nodes only.
- All asset URLs work under `BASE_PATH`.
- After each task: `npm run typecheck`, `npm test`, `npm run e2e` all pass, then commit and push `main` (conventional message, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never push with failing checks.
- Remove the shipped item's entry from `docs/BACKLOG.md` in the same commit.

## Review Focus

1. **AI returns empty code while the workbench is empty.** `awaitRender('')` must still resolve (with a failed result "The code is empty"), or the chat turn hangs forever. Test in Task 4.
2. **Splitter dragged past a limit, or the window shrinks below the stored widths.** Panels clamp and the 3D view keeps at least 360 px; the stored value is not overwritten by the clamp. Test in Task 5.
3. **Model list request races.** Typing a key character by character must not leave an older, failed response on screen after a newer success. Only the latest request's result is applied. Test in Task 6.
4. **Switching the turntable frame count mid-render.** The old render is aborted; frames from it never mix into the new loop. Test in Task 3.
5. **"Current view" when the viewer was never shown** (no pose with aspect). Falls back to the iso preset fitted to the export aspect. Test in Task 2.

---

### Task 1: The ChatSCAD title goes home

**Files:**
- Create: `src/ui/BrandTitle.tsx`, `src/ui/BrandTitle.test.tsx`
- Modify: `src/App.tsx` (desktop header `<h1>`), `src/gallery/GalleryView.tsx` (header `<span>`), `docs/BACKLOG.md`

**Interfaces:**
- Produces: `BrandTitle(): JSX.Element`, which reads `view` from `useAppStore`.

- [ ] **Step 1: Write the failing test** (`src/ui/BrandTitle.test.tsx`)

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useAppStore } from '../state/store'
import { BrandTitle } from './BrandTitle'

afterEach(() => useAppStore.setState({ view: 'workbench' }))

it('is plain text on the workbench', () => {
  render(<BrandTitle />)
  expect(screen.getByRole('heading', { name: 'ChatSCAD' })).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})

it.each(['settings', 'history', 'gallery'] as const)('goes back to the project from %s', (view) => {
  useAppStore.setState({ view })
  render(<BrandTitle />)
  fireEvent.click(screen.getByRole('button', { name: 'ChatSCAD, back to project' }))
  expect(useAppStore.getState().view).toBe('workbench')
})
```

- [ ] **Step 2:** Run `npx vitest run src/ui/BrandTitle.test.tsx`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/ui/BrandTitle.tsx`

```tsx
import { useAppStore } from '../state/store'

const TEXT = 'text-[15px] font-bold tracking-tight'

/** The header title. Off the workbench it is a button back to the project; on it, plain text. */
export function BrandTitle() {
  const view = useAppStore((s) => s.view)
  if (view === 'workbench') return <h1 className={TEXT}>ChatSCAD</h1>
  return (
    <h1 className={TEXT}>
      <button
        type="button"
        aria-label="ChatSCAD, back to project"
        title="Back to project"
        className="-ml-2 h-(--control-sm) rounded-sm px-2 hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
        onClick={() => useAppStore.getState().setView('workbench')}
      >
        ChatSCAD
      </button>
    </h1>
  )
}
```

Replace `<h1 className="text-[15px] font-bold tracking-tight">ChatSCAD</h1>` in `App.tsx` and `<span className="text-[15px] font-bold tracking-tight">ChatSCAD</span>` in `GalleryView.tsx` with `<BrandTitle />`. Gallery already has an `<h1>` ("Start from a working model"); that is acceptable (header title and page heading), matching settings today.

- [ ] **Step 4:** Run `npx vitest run src/ui src/App.test.tsx src/gallery src/settings`. Expected: PASS. If `App.test.tsx` or `GalleryView.test.tsx` query the heading by name "ChatSCAD" off the workbench, query `getByRole('button', { name: 'ChatSCAD, back to project' })` instead.
- [ ] **Step 5:** Remove the "The ChatSCAD title goes home" section from `docs/BACKLOG.md`. Run the full checks, then commit `feat: the ChatSCAD title goes back to the project` and push.

---

### Task 2: Image export shows the whole model

**Files:**
- Modify: `src/export/frames.ts`, `src/export/glFrameRenderer.ts`, `src/viewer/Viewer.tsx` (`PoseReporter`), `src/export/tabs/ImageTab.tsx`, `src/export/tabs/TurntableTab.tsx`, `src/export/turntable.ts`, `docs/BACKLOG.md`
- Test: `src/export/frames.test.ts`

**Interfaces:**
- Produces:
  - `CameraPose { position; target; up?; fov?: number; aspect?: number }`. `fov` is the vertical fov in degrees used to draw this pose (default `FRAME_FOV`). `aspect` is the width / height of the view that framed it.
  - `fitPoseToAspect(pose: CameraPose, aspect: number): CameraPose` returns the pose with `fov` set so nothing the source view showed is cropped at `aspect`.
  - `presetPose(bounds, preset, aspect = 1)` and `turntablePoses(bounds, frames, aspect = 1)`.
  - `glFrameRenderer.render(pose)` uses `pose.fov ?? FRAME_FOV`.

- [ ] **Step 1: Write the failing tests** (append to `src/export/frames.test.ts`)

```ts
import { PerspectiveCamera, Vector3 } from 'three'
import { fitPoseToAspect, presetPose, FRAME_FOV, type CameraPose } from './frames'
import type { Bounds } from '../render/types'

const BOUNDS: Bounds = { min: [0, 0, 0], max: [88.8, 25.4, 22] }

function corners(b: Bounds): Vector3[] {
  const out: Vector3[] = []
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push(new Vector3(x, y, z))
  return out
}

function inFrame(pose: CameraPose, aspect: number, b: Bounds): boolean {
  const cam = new PerspectiveCamera(pose.fov ?? FRAME_FOV, aspect, 0.1, 10_000)
  cam.up.set(...(pose.up ?? [0, 0, 1]))
  cam.position.set(...pose.position)
  cam.lookAt(...pose.target)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  return corners(b).every((c) => {
    const p = c.clone().project(cam)
    return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1
  })
}

describe.each([
  ['1080 × 1080', 1],
  ['1920 × 1080', 1920 / 1080],
  ['800 × 600', 800 / 600],
])('at %s', (_label, aspect) => {
  it.each(['iso', 'front', 'top'] as const)('the %s preset keeps the whole model in frame', (preset) => {
    expect(inFrame(presetPose(BOUNDS, preset, aspect), aspect, BOUNDS)).toBe(true)
  })
})

it('keeps what a wide viewer showed when the export is square', () => {
  // A wide viewer framed tightly: fit for its own aspect, as the viewer's Fit view does.
  const viewer = { ...presetPose(BOUNDS, 'iso', 2.4), aspect: 2.4 }
  expect(inFrame(viewer, 1, BOUNDS)).toBe(false) // the old behaviour crops
  expect(inFrame(fitPoseToAspect(viewer, 1), 1, BOUNDS)).toBe(true)
})

it('keeps the vertical fov when the export is wider than the viewer', () => {
  const viewer = { ...presetPose(BOUNDS, 'iso', 1), aspect: 1 }
  expect(fitPoseToAspect(viewer, 16 / 9).fov).toBe(FRAME_FOV)
})

it('leaves a pose without an aspect alone', () => {
  const pose = presetPose(BOUNDS, 'iso', 1)
  expect(fitPoseToAspect(pose, 1)).toEqual({ ...pose, fov: FRAME_FOV })
})
```

- [ ] **Step 2:** Run `npx vitest run src/export/frames.test.ts`. Expected: FAIL (`fitPoseToAspect` not exported; presets crop at 1920 × 1080 for some presets is acceptable to pass already, the import error fails the file).

- [ ] **Step 3: Implement** in `src/export/frames.ts`

```ts
export interface CameraPose {
  position: Vec3
  target: Vec3
  up?: Vec3
  /** Vertical field of view in degrees used to draw this pose; FRAME_FOV when absent. */
  fov?: number
  /** Width / height of the view that framed this pose (the main viewer's canvas). */
  aspect?: number
}

const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Widens the vertical fov when the image is narrower than the view that framed `pose`, so its sides are never cropped. */
export function fitPoseToAspect(pose: CameraPose, aspect: number): CameraPose {
  const vFov = pose.fov ?? FRAME_FOV
  if (!pose.aspect || aspect >= pose.aspect) return { ...pose, fov: vFov }
  const halfH = Math.atan(Math.tan(rad(vFov) / 2) * pose.aspect)
  return { ...pose, fov: deg(2 * Math.atan(Math.tan(halfH) / aspect)) }
}

export function presetPose(bounds: Bounds, preset: 'iso' | 'front' | 'top', aspect = 1): CameraPose {
  const fit = computeCameraFit(bounds, FRAME_FOV, aspect)
  // …unchanged switch…
}

export function turntablePoses(bounds: Bounds, frames: number, aspect = 1): CameraPose[] {
  const { position, target } = presetPose(bounds, 'iso', aspect)
  // …unchanged…
}
```

In `glFrameRenderer.ts` `render(pose)`: add `camera.fov = pose.fov ?? FRAME_FOV` before `updateProjectionMatrix()` (import `FRAME_FOV` from `./frames`; if that import is circular, move `FRAME_FOV` to `src/export/fov.ts` and re-export it from `frames.ts`).

In `Viewer.tsx` `PoseReporter`: also read `size` from `useThree((s) => s.size)` and record `fov: (camera as PerspectiveCamera).fov, aspect: size.width / size.height` (only when `size.height > 0`), and add `size` to the effect dependencies.

In `ImageTab.tsx`:

```ts
export function poseFor(choice: CameraChoice, bounds: Bounds, aspect: number): CameraPose {
  const viewer = choice === 'current' ? getViewerPose() : null
  return viewer ? fitPoseToAspect(viewer, aspect) : presetPose(bounds, choice === 'current' ? 'iso' : choice, aspect)
}
```

Call sites pass `size[0] / size[1]` of `IMAGE_SIZES[sizeIndex].size` (the same aspect for preview and save). In `TurntableTab.tsx` and `exportTurntable` pass the GIF aspect to `presetPose` / `turntablePoses`.

- [ ] **Step 4:** Add a test to `src/export/tabs/ImageTab.test.tsx`: with `setViewerPose(null)` and camera "Current view" unavailable, `poseFor('current', BOUNDS, 1)` equals `presetPose(BOUNDS, 'iso', 1)` (Review Focus 5). Run `npx vitest run src/export src/viewer`. Expected: PASS.
- [ ] **Step 5:** Remove the "Image export shows the whole model" backlog entry. Full checks, commit `fix: image export keeps the whole model in frame`, push.

---

### Task 3: Animated turntable preview

**Files:**
- Create: `src/export/useFrameLoop.ts`, `src/export/useFrameLoop.test.ts`, `src/ui/useReducedMotion.ts`
- Modify: `src/export/tabs/TurntableTab.tsx`, `src/export/tabs/TurntableTab.test.tsx`, `src/ui/icons.tsx` (add `IconPlay`, `IconPause` if missing), `docs/BACKLOG.md`

**Interfaces:**
- Produces:
  - `useFrameLoop(count: number, delayMs: number, playing: boolean): number` (the current frame index, 0 when `count === 0`; pauses while `document.visibilityState === 'hidden'`).
  - `useReducedMotion(): boolean` (`matchMedia('(prefers-reduced-motion: reduce)')`, false when `matchMedia` is missing).

- [ ] **Step 1: Write the failing hook test** (`src/export/useFrameLoop.test.ts`)

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFrameLoop } from './useFrameLoop'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('advances one frame per delay and wraps', () => {
  const { result } = renderHook(() => useFrameLoop(3, 100, true))
  expect(result.current).toBe(0)
  act(() => vi.advanceTimersByTime(100))
  expect(result.current).toBe(1)
  act(() => vi.advanceTimersByTime(200))
  expect(result.current).toBe(0)
})

it('holds still when not playing', () => {
  const { result } = renderHook(() => useFrameLoop(3, 100, false))
  act(() => vi.advanceTimersByTime(500))
  expect(result.current).toBe(0)
})

it('pauses while the page is hidden', () => {
  const { result } = renderHook(() => useFrameLoop(3, 100, true))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  act(() => vi.advanceTimersByTime(500))
  expect(result.current).toBe(0)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  act(() => vi.advanceTimersByTime(100))
  expect(result.current).toBe(1)
})

it('keeps the index inside a shrinking frame list', () => {
  const { result, rerender } = renderHook(({ n }) => useFrameLoop(n, 100, true), { initialProps: { n: 5 } })
  act(() => vi.advanceTimersByTime(400))
  rerender({ n: 2 })
  expect(result.current).toBeLessThan(2)
})
```

- [ ] **Step 2:** Run it. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/export/useFrameLoop.ts`

```ts
import { useEffect, useState } from 'react'

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/** The frame to show in a looping preview. Stops while not playing or while the page is hidden. */
export function useFrameLoop(count: number, delayMs: number, playing: boolean): number {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(() => !hidden())

  useEffect(() => {
    const onChange = () => setVisible(!hidden())
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  useEffect(() => {
    if (!playing || !visible || count < 2) return
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), delayMs)
    return () => clearTimeout(id)
  }, [index, count, delayMs, playing, visible])

  return count === 0 ? 0 : index % count
}
```

`src/ui/useReducedMotion.ts`:

```ts
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(QUERY)
    const onChange = () => setReduce(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduce
}
```

- [ ] **Step 4: Write the failing TurntableTab tests.** Follow the file's existing mocking of `renderFrames` (it already stubs frame rendering; reuse that stub, recording `cameras.length`). Add:
  - "previews every turntable frame": with frames "48", the preview's `renderFrames` call gets 48 cameras.
  - "restarts the preview when the frame count changes": change Frames to 36 and blur; the latest call has 36 cameras and the earlier call's signal is aborted, and frames that arrive from it afterwards are not shown (Review Focus 4).
  - "starts paused with reduced motion": stub `window.matchMedia` to match `(prefers-reduced-motion: reduce)`; expect a button "Play preview".
  - "shows rendering progress": while the stub has yielded 2 of 48, the text "Rendering preview frames · 2 of 48" is shown.

- [ ] **Step 5: Implement** in `TurntableTab.tsx`:
  - State `previewFrames: ImageData[]`, `userPaused: boolean` (initial `useReducedMotion()`), keep `preview` for the save's streamed frames.
  - Preview effect deps `[mesh, frames, sizeIndex, transparent]`. Body: skip if `run.current`; `const controller = new AbortController()`; `setPreviewFrames([])`; iterate `renderFrames({ mesh, size: previewSize(GIF_SIZES[sizeIndex].size), background, cameras: turntablePoses(mesh.bounds, frames, aspect) })`, `if (controller.signal.aborted) break`, else `setPreviewFrames((f) => [...f, frame])`. Cleanup aborts.
  - `const index = useFrameLoop(previewFrames.length, turntableDelayMs(frames), !userPaused && progress === null)`.
  - `FramePreview frame={progress ? preview : (previewFrames[index] ?? null)}`.
  - Overlay: top-right `frame {index + 1} / {frames}` (or the save progress as today); bottom-left a `vbtn`-styled button (`grid size-(--control-sm) place-items-center rounded-sm border border-line bg-panel text-ink-muted hover:text-ink`) with `aria-label` "Pause preview" / "Play preview", plus `<span className="pc-caption">Rendering preview frames · {previewFrames.length} of {frames}</span>` while `previewFrames.length < frames`.
  - Caption under the preview: `Plays like the GIF: {frames} frames, one turn every {seconds} s.` where seconds = `(turntableDelayMs(frames) * frames / 1000)` rounded to one decimal.
- [ ] **Step 6:** Run `npx vitest run src/export`. Expected: PASS.
- [ ] **Step 7:** Remove the backlog entry. Full checks, commit `feat: the turntable preview plays like the GIF`, push.

---

### Task 4: New projects start empty

**Files:**
- Modify: `src/state/store.ts`, `src/render/useRenderLoop.ts`, `src/ui/StatusPill.tsx`, `src/panels/ConsolePanel.tsx`, `src/export/ExportButtons.tsx`, `src/workbench/ProblemsPanel.tsx` (only if its switch is exhaustive), `src/viewer/Viewer.tsx`, `src/editor/CodeEditor.tsx` (placeholder), `src/chat/sendPrompt.ts`, `src/variants/startVariants.ts`, `src/workbench/ProjectMenu.tsx`, `src/chat/ChatPanel.tsx` (empty state only if none exists), the unit tests that import `DEFAULT_CODE`, `e2e/support.ts` and the e2e specs listed below, `docs/BACKLOG.md`
- Create: `src/test/fixtures.ts` (exports `STARTER_CODE`, the old `DEFAULT_CODE` text, for unit tests)

**Interfaces:**
- Produces: `RenderStatus = 'idle' | 'rendering' | 'ok' | 'error' | 'empty'`; store action `renderEmpty(): void`; `isEmptyCode(code: string): boolean` exported from `src/state/store.ts`; `EMPTY_CODE_ERROR = 'The code is empty'`.

- [ ] **Step 1: Write failing store and loop tests.**

`src/state/store.test.ts`:

```ts
it('starts with empty code', () => {
  expect(useAppStore.getInitialState().code).toBe('')
})

it('renderEmpty clears the model and records a failed render for the empty code', () => {
  useAppStore.getState().renderEmpty()
  const s = useAppStore.getState()
  expect(s.status).toBe('empty')
  expect(s.mesh).toBeNull()
  expect(s.stl).toBeNull()
  expect(s.logs).toEqual([])
  expect(s.lastRender).toEqual({ code: s.code, result: { ok: false, error: 'The code is empty', logs: [], diagnostics: [], renderMs: 0 } })
})
```

(Adjust the `result` literal to `ResultBase`'s exact fields in `src/render/types.ts`.)

`src/render/useRenderLoop.test.ts`: "sends nothing to the worker while the code is empty" (render the hook with initial empty code and a spy worker; advance timers past the debounce; spy not called; status is `empty`), and "renders once code is typed" (set code to `cube(1);`; spy called once). Add to `src/render/awaitRender.test.ts` (or create it): `awaitRender('')` resolves with `ok: false` after `renderEmpty()` (Review Focus 1).

- [ ] **Step 2:** Run them. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `store.ts`: delete `DEFAULT_CODE`; `code: ''`; add `'empty'` to `RenderStatus`; add

```ts
export const EMPTY_CODE_ERROR = 'The code is empty'
export const isEmptyCode = (code: string): boolean => code.trim() === ''
// in the store:
renderEmpty: () =>
  set((s) => ({
    status: 'empty',
    mesh: null,
    stl: null,
    renderedCode: null,
    renderedParams: null,
    preview: null,
    lastRender: { code: s.code, result: { ok: false, error: EMPTY_CODE_ERROR, logs: [], diagnostics: [], renderMs: 0 } },
    logs: [],
    diagnostics: [],
    error: null,
    renderMs: null,
  })),
```

  - `useRenderLoop.ts` `send`: after cancelling previews, `if (isEmptyCode(code)) { controller.cancel(); useAppStore.getState().renderEmpty(); return }`.
  - `describeStatus`: `case 'empty': return { ...base, tone: 'busy', label: 'Nothing to render' }`. Add a `'neutral'` tone if `busy` shows a spinner: `PillTone` gains `'neutral'` with no `is-*` class and an `IconBox`-style empty icon (reuse an existing icon; no new hex). `summaryLine`: `case 'empty': return null`. `exportDisabledReason`: `case 'empty': return 'Write or generate a model first'`. Fix any other exhaustive switch the type checker flags.
  - `Viewer.tsx`: new prop `empty?: boolean`; when true render, over the canvas:

```tsx
<div className="absolute inset-0 grid place-items-center p-4">
  <div className="flex max-w-90 flex-col items-center gap-3 rounded-lg border border-line bg-panel p-6 text-center">
    <h2 className="text-[16px] leading-[22px] font-semibold">Nothing to render yet</h2>
    <p className="pc-muted">Describe a part in the chat, write OpenSCAD in the editor, or start from an example.</p>
    <button type="button" className="pc-btn is-sm" onClick={() => useAppStore.getState().setView('gallery')}>
      Browse examples
    </button>
  </div>
</div>
```

    `App.tsx` passes `empty={status === 'empty'}` to the workbench and phone `Viewer`s.
  - `CodeEditor.tsx`: add `placeholder('Write OpenSCAD here, or describe a part in the chat')` from `@codemirror/view` to the extensions.
  - `sendPrompt.ts` / `startVariants.ts`: replace the `DEFAULT_CODE` comparisons with `isEmptyCode(code) ? '' : code` (keep the `!input.selection` condition in sendPrompt).
  - `ProjectMenu.tsx`: `newProject({ code: '', origin: 'blank' })`.
  - `ChatPanel.tsx`: if it has no empty state, show "Describe what you want to make" and the caption `For example, “a wall hook for a 30 mm broom handle”.` when there are no messages.
  - Unit tests that import `DEFAULT_CODE` import `STARTER_CODE` from `src/test/fixtures.ts` and set it explicitly (`useAppStore.setState({ code: STARTER_CODE })`) where they relied on the starter. `header.test.tsx` "starts a new project from the default model" now expects code `''`. `App.test.tsx` tests that expect "20 × 20 × 10 mm" set `STARTER_CODE` before render; add a test that a fresh App shows "Nothing to render yet", the pill "Nothing to render", and a disabled Export STL, and that the worker was never called.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: E2E.** In `e2e/support.ts` add:

```ts
export const STARTER_CODE = `/* [Dimensions] */
width = 20;  // [5:1:100]
depth = 20;  // [5:1:100]
height = 10; // [2:1:50]

difference() {
  cube([width, depth, height]);
  translate([width / 2, depth / 2, 2])
    cylinder(h = height, r = min(width, depth) / 4, $fn = 48);
}
`

export async function replaceCode(page: Page, code: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(code)
}

export async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.getByTestId('render-status')).toHaveText(/^(Nothing to render|Rendered)/, { timeout: RENDER_TIMEOUT })
}

/** Opens the app and loads the old starter model, for specs that need something rendered. */
export async function openWithStarter(page: Page): Promise<void> {
  await page.goto('./')
  await waitForAppReady(page)
  await replaceCode(page, STARTER_CODE)
  await waitForFirstRender(page)
}
```

`seedFakeProvider` uses `waitForAppReady` instead of `waitForFirstRender` (both places). Then update each spec that relies on the starter: `smoke.spec.ts` (remove its local `replaceCode`; first test uses `openWithStarter`), `phone.spec.ts`, `history.spec.ts`, `ai-loop.spec.ts`, `variants.spec.ts`, `pwa.spec.ts`, `export.spec.ts` (`openExport` calls `openWithStarter`). On phones, `replaceCode` needs the Code tab first: add a `phone` flag or a separate step in `phone.spec.ts` that taps the Code tab before typing. Add `e2e/empty.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { waitForAppReady } from './support'

test('a new project opens empty', async ({ page }) => {
  await page.goto('./')
  await waitForAppReady(page)
  await expect(page.getByTestId('render-status')).toHaveText('Nothing to render')
  await expect(page.getByRole('heading', { name: 'Nothing to render yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeDisabled()
})
```

- [ ] **Step 6:** Run `npm run typecheck && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 7:** Remove the backlog entry. Commit `feat: new projects start empty`, push.

---

### Task 5: Resizable panels on desktop

**Files:**
- Create: `src/layout/Splitter.tsx`, `src/layout/Splitter.test.tsx`, `src/layout/panelLayout.ts`, `src/layout/panelLayout.test.ts`
- Modify: `src/db/db.ts` (`Settings.panelLayout`, default `null`), `src/db/prefs.ts`, `src/settings/prefsStore.ts`, `src/App.tsx`, `src/workbench/CodePane.tsx`, `src/customizer/CustomizerDock.tsx`, `src/settings/sections/AppearanceSection.tsx`, tests for those, `e2e/layout.spec.ts`, `docs/BACKLOG.md`

**Interfaces:**
- Produces:
  - `interface PanelLayout { chatWidth: number; codeWidth: number; dockHeight: number | null; consoleHeight: number }`
  - `DEFAULT_LAYOUT: PanelLayout = { chatWidth: 360, codeWidth: 440, dockHeight: null, consoleHeight: 176 }`
  - `LIMITS = { chat: [280, 560], code: [320, 720], minViewerWidth: 360, dockMin: 96, consoleMin: 72, minAbove: 160 }`
  - `clampColumns(layout, windowWidth): { chatWidth; codeWidth }` (shrinks code then chat so the 3D view keeps `minViewerWidth`; never below the lower limits).
  - `layoutFrom(value: unknown): PanelLayout` (validates a stored row; invalid → defaults).
  - `Prefs` gains `panelLayout: PanelLayout`. `usePrefs.update({ panelLayout })` persists.
  - `Splitter({ orientation: 'vertical' | 'horizontal'; label: string; value: number; min: number; max: number; defaultValue: number; invert?: boolean; onChange(v: number): void; onCommit(v: number): void })`. `invert` is for panes whose size grows when the pointer moves left/up (code column, dock, console).

- [ ] **Step 1: Write failing tests.**

`src/layout/panelLayout.test.ts`:

```ts
import { expect, it } from 'vitest'
import { clampColumns, DEFAULT_LAYOUT, layoutFrom } from './panelLayout'

it('keeps stored widths when they fit', () => {
  expect(clampColumns({ ...DEFAULT_LAYOUT, chatWidth: 400, codeWidth: 500 }, 1600)).toEqual({ chatWidth: 400, codeWidth: 500 })
})

it('shrinks the code column first so the 3D view keeps 360 px', () => {
  expect(clampColumns({ ...DEFAULT_LAYOUT, chatWidth: 400, codeWidth: 700 }, 1200)).toEqual({ chatWidth: 400, codeWidth: 438 })
})

it('never goes below the column minimums', () => {
  expect(clampColumns({ ...DEFAULT_LAYOUT, chatWidth: 560, codeWidth: 720 }, 800)).toEqual({ chatWidth: 280, codeWidth: 320 })
})

it('falls back to defaults for a broken stored value', () => {
  expect(layoutFrom({ chatWidth: 'wide' })).toEqual(DEFAULT_LAYOUT)
  expect(layoutFrom(undefined)).toEqual(DEFAULT_LAYOUT)
  expect(layoutFrom({ chatWidth: 9999, codeWidth: 400, dockHeight: null, consoleHeight: 200 }).chatWidth).toBe(560)
})
```

(1200 − 2 splitter px − 400 − 360 = 438.)

`src/layout/Splitter.test.tsx`: renders `role="separator"` with `aria-orientation`, `aria-valuenow/min/max`; ArrowRight on a vertical splitter calls `onChange(value + 16)` and `onCommit`; ArrowRight on an inverted one calls `value − 16`; Home → min, End → max; values clamp at min/max; double-click calls `onCommit(defaultValue)`; pointer drag from x=100 to x=140 calls `onChange(value + 40)` and `onCommit` on pointerup (fire `pointerdown`, `pointermove`, `pointerup` with `clientX`; stub `setPointerCapture`).

- [ ] **Step 2:** Run them. Expected: FAIL.

- [ ] **Step 3: Implement** `panelLayout.ts` (pure functions above; `clampColumns` uses 2 px for the two splitter tracks) and `Splitter.tsx`:

```tsx
import { useRef, useState } from 'react'

const STEP = 16

export function Splitter({ orientation, label, value, min, max, defaultValue, invert = false, onChange, onCommit }: SplitterProps) {
  const start = useRef<{ pos: number; value: number } | null>(null)
  const [active, setActive] = useState(false)
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)))
  const sign = invert ? -1 : 1
  const vertical = orientation === 'vertical'
  const axis = (e: React.PointerEvent) => (vertical ? e.clientX : e.clientY)
  const keys: Record<string, (v: number) => number> = vertical
    ? { ArrowLeft: (v) => v - STEP * sign, ArrowRight: (v) => v + STEP * sign, Home: () => min, End: () => max }
    : { ArrowUp: (v) => v - STEP * sign, ArrowDown: (v) => v + STEP * sign, Home: () => min, End: () => max }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Drag to resize. Double-click to reset."
      data-active={active || undefined}
      className={`relative z-10 shrink-0 touch-none bg-line outline-none focus-visible:bg-accent data-active:bg-accent ${
        vertical ? 'w-px cursor-col-resize after:absolute after:inset-y-0 after:-inset-x-1 after:content-[""]' : 'h-px cursor-row-resize after:absolute after:inset-x-0 after:-inset-y-1 after:content-[""]'
      }`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { pos: axis(e), value }
        setActive(true)
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(clamp(start.current.value + (axis(e) - start.current.pos) * sign))
      }}
      onPointerUp={(e) => {
        if (!start.current) return
        const v = clamp(start.current.value + (axis(e) - start.current.pos) * sign)
        start.current = null
        setActive(false)
        onCommit(v)
      }}
      onDoubleClick={() => onCommit(defaultValue)}
      onKeyDown={(e) => {
        const next = keys[e.key]
        if (!next) return
        e.preventDefault()
        const v = clamp(next(value))
        onChange(v)
        onCommit(v)
      }}
    />
  )
}
```

  Prefs: add `panelLayout: PanelLayout | null` to `Settings` (default `null`) and `panelLayout: layoutFrom(row?.panelLayout)` to `prefsFrom`; `Prefs` picks it; `usePrefs` initial state `panelLayout: DEFAULT_LAYOUT`.

  `App.tsx` desktop: a `useWorkbenchLayout()` hook in `src/layout/panelLayout.ts` holds a live `draft` (state, updated on `onChange`) seeded from `usePrefs((s) => s.panelLayout)`, `commit(patch)` sets the draft and calls `usePrefs.getState().update({ panelLayout: next })`, and tracks `window.innerWidth` via a resize listener. `const { chatWidth, codeWidth } = clampColumns(draft, windowWidth)`. Replace the `md:grid-cols-[360px_minmax(0,1fr)_440px]` main with a desktop-only (`!isPhone` branch already) inline style `gridTemplateColumns: \`${chatWidth}px 1px minmax(${LIMITS.minViewerWidth}px,1fr) 1px ${codeWidth}px\`` and children `ChatPanel`, `Splitter` (label "Resize chat", min 280, max 560, default 360), 3D section, `Splitter` (label "Resize code", `invert`, min 320, max 720, default 440), `CodePane consoleHeight={draft.consoleHeight} onConsoleResize=…`. Remove `md:border-l` from the 3D section and `CodePane` on desktop (the splitter line is the border). Keep the phone-only classes working: `PhoneLayout` does not render this `main`.

  3D section: `<Viewer>` wrapper `min-h-0 flex-1`; when the code has parameters (`useMemo(() => parseCustomizer(code).length > 0, [code])`) render `Splitter` (label "Resize parameters", horizontal, `invert`, min 96, max = section height − 160 measured with a `ResizeObserver` ref, default = the dock's natural height, i.e. `dockHeight: null`) above `<CustomizerDock height={draft.dockHeight} />`. Double-click commits `null` for the dock (back to natural height): give `Splitter` `defaultValue` as the measured natural height and have the App's `onCommit` store `null` when `v === natural`.

  `CustomizerDock`: optional `height?: number | null`; when a number, replace `max-h-[45%]` with `style={{ height }}` (still `overflow-auto`, `shrink-0`).

  `CodePane`: optional `consoleHeight?: number` (default 176) and `onConsoleResize?(v: number, commit: boolean): void`; when `onConsoleResize` is given, render a horizontal `invert` `Splitter` ("Resize console", min 72, max = pane height − 160, default 176) before the console and use `style={{ height: consoleHeight }}` instead of `h-44`.

  `AppearanceSection`: add

```tsx
<div className="flex flex-col gap-2">
  <span className="pc-label">Panel layout</span>
  <div className="pc-row">
    <button type="button" className="pc-btn is-sm" onClick={() => void usePrefs.getState().update({ panelLayout: DEFAULT_LAYOUT })}>
      Reset layout
    </button>
  </div>
  <span className="pc-hint">Panel sizes are saved on this device. Double-click a divider to reset just that one.</span>
</div>
```

- [ ] **Step 4:** Tests: `App.test.tsx` "shows four separators on desktop" (with `STARTER_CODE`, which has parameters) and "none on a phone" (matchMedia phone stub as in existing phone tests); `prefs.test.ts` round-trips `panelLayout`; `AppearanceSection` test: Reset layout writes `DEFAULT_LAYOUT`. Run `npm test`. Expected: PASS. Update the region-order assertion in `App.test.tsx` only if separators change it (they are not regions, so it should not).
- [ ] **Step 5: E2E** `e2e/layout.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { openWithStarter } from './support'

test('panel sizes survive a reload and reset from settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openWithStarter(page)
  const chat = page.getByRole('region', { name: 'Chat' })
  const splitter = page.getByRole('separator', { name: 'Resize chat' })
  const box = (await splitter.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(splitter).toHaveAttribute('aria-valuenow', '460')
  await page.reload()
  await expect(page.getByRole('separator', { name: 'Resize chat' })).toHaveAttribute('aria-valuenow', '460')
  expect(Math.round((await chat.boundingBox())!.width)).toBe(460)
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Appearance' }).click()
  await page.getByRole('button', { name: 'Reset layout' }).click()
  await page.getByRole('tab', { name: 'Project' }).click()
  await expect(page.getByRole('separator', { name: 'Resize chat' })).toHaveAttribute('aria-valuenow', '360')
})
```

  If the Chat panel is not `role="region"` (a `<section aria-label>` is), adjust the locator to `page.locator('section[aria-label="Chat"]')`.
- [ ] **Step 6:** Full checks. Remove the backlog entry. Commit `feat: resizable panels on desktop`, push.

---

### Task 6: Model picker with pricing

**Files:**
- Create: `src/settings/ModelCombobox.tsx`, `src/settings/ModelCombobox.test.tsx`, `src/settings/useModelList.ts`, `src/settings/useModelList.test.ts`
- Modify: `src/ai/types.ts` (`ModelInfo.capabilities`), `src/ai/openaiCompatible.ts` (modalities), `src/ai/openaiCompatible.test.ts`, `src/settings/ProfileForm.tsx`, `src/settings/ProfileForm.test.tsx`, `docs/BACKLOG.md`

**Interfaces:**
- Produces:
  - `ModelInfo { id; name?; price?; capabilities?: { vision?: boolean; audio?: boolean } }`
  - `formatPrice(p: ModelPrice): string` → `"$3.00 / $15.00"` (two decimals; below $0.01 use up to 4 significant digits, e.g. `"$0.0005 / $0.0015"`).
  - `listsWithoutKey(baseUrl: string): boolean` (OpenRouter host or `isLocalBaseUrl`).
  - `useModelList(profile: ProviderProfile, opts?: { delayMs?: number; create?: typeof createProvider }): ModelListState` where `type ModelListState = { phase: 'idle' } | { phase: 'loading' } | { phase: 'loaded'; count: number } | { phase: 'error'; reason: string }`, plus `reload(): void`. On success it patches `cachedModels` through `useProvidersStore.getState().updateProfile`.
  - `ModelCombobox({ id, value, models, priceTable, onChange(id: string): void, onPick(model: ModelInfo): void })`.

- [ ] **Step 1: Adapter test** (`src/ai/openaiCompatible.test.ts`): a `/models` row with `architecture: { input_modalities: ['text', 'image'] }` maps to `capabilities: { vision: true, audio: false }`; `['text','audio']` → `{ vision: false, audio: true }`; no `architecture` → no `capabilities` key. Run: FAIL.
- [ ] **Step 2: Implement.** `OpenAiModel` gains `architecture?: { input_modalities?: unknown }`. In the `flatMap`:

```ts
const modalities = Array.isArray(m.architecture?.input_modalities) ? (m.architecture.input_modalities as unknown[]) : null
const capabilities = modalities ? { vision: modalities.includes('image'), audio: modalities.includes('audio') } : undefined
return [{ id: m.id, ...(name), ...(price ? { price } : {}), ...(capabilities ? { capabilities } : {}) }]
```

  Run: PASS.

- [ ] **Step 3: Hook tests** (`src/settings/useModelList.test.ts`, fake timers, a fake `create` returning a provider whose `listModels` is a `vi.fn`):
  - "loads on mount for a keyless server": profile `baseUrl: 'http://localhost:11434/v1'`, `apiKey: ''` → `listModels` called after `delayMs`; state `loaded` with the count; `updateProfile` called with `cachedModels`.
  - "waits for a key otherwise": OpenAI URL, empty key → not called; set key `sk-1` → called once after the delay; typing `sk-12` within the delay restarts it (still once).
  - "reports what failed": `listModels` rejects `new ProviderError('auth', 'Invalid key', 401)` → `{ phase: 'error', reason }` where `reason` is `describeProviderError(err, baseUrl).title`.
  - "ignores a stale answer" (Review Focus 3): first call resolves after the second; the final state is the second call's.
  - Run: FAIL.
- [ ] **Step 4: Implement** `useModelList.ts`: an effect keyed on `[profile.baseUrl, profile.apiKey, profile.adapter]`; skip when `!profile.baseUrl.trim()` or (no key and `!listsWithoutKey(baseUrl)`); `setTimeout(delayMs = 600)`; an `AbortController` plus a request counter so only the latest result is applied; on success `updateProfile(profile.id, { cachedModels: models })` and `{ phase: 'loaded', count }`; on error `{ phase: 'error', reason: describeProviderError(err, profile.baseUrl).title }`. `reload()` bumps a counter in the deps. Run: PASS.
- [ ] **Step 5: Combobox tests** (`ModelCombobox.test.tsx`):
  - typing "son" filters by id and name, case-insensitive; options show name, id, `"$3.00 / $15.00"` and a "vision" tag; a model without price shows "No price listed".
  - `priceTable` entry overrides the listed price.
  - ArrowDown + Enter picks the highlighted option (`onPick` with the model, `onChange` with its id); Escape closes.
  - the last option reads `Use “gpt-x” as typed` when the query is not an exact id, and choosing it calls `onChange('gpt-x')`.
  - shows at most 50 options and the caption `50 of 342 models · prices per 1M input / output tokens`.
  - blurring with a typed value keeps it (`onChange` was called on each keystroke).
  - Run: FAIL.
- [ ] **Step 6: Implement** `ModelCombobox.tsx`: `input role="combobox" aria-expanded aria-controls aria-activedescendant aria-autocomplete="list"` inside `pc-input is-mono` with the search icon (`IconSearch`); open on focus/typing; listbox `absolute inset-x-0 top-full z-20 mt-1 flex max-h-80 flex-col overflow-auto rounded-md border border-line bg-panel-raised p-1 shadow-(--shadow-pop)`; each `role="option"` row is a two-column grid (name / price, id / tags), `aria-selected` row gets `bg-accent-soft`; option ids `${id}-opt-${i}`; `onMouseDown` preventDefault so the input keeps focus; the caption row is not an option. Export `formatPrice`. Run: PASS.
- [ ] **Step 7: Wire into `ProfileForm`.** Replace the input + datalist with `ModelCombobox` (`id={id('model')}`, `value={profile.defaultModel}`, `models={profile.cachedModels}`, `priceTable={profile.priceTable}`, `onChange={(m) => patch({ defaultModel: m })}`, `onPick` sets `defaultModel` and, when `model.capabilities` exists, `capabilities: { ...profile.capabilities, vision: !!model.capabilities.vision, audio: !!model.capabilities.audio }` and remembers (local state) that the switches came from the list so a caption "From the model list" shows next to them until the user flips one). Hint from `useModelList`:
  - loading: `Loading the model list from {profile.name || host}…`
  - loaded or cached: `{n} models from {name}. Type to search, or enter any model name.`
  - error: `Couldn't load the model list: {reason}. Type a model name instead.`
  - idle with nothing cached: `Enter the API key to load the model list, or type a model name.`
  `runTest` also calls `reload()` after a success. Update `ProfileForm.test.tsx` cases that used the datalist (query `getByRole('combobox', { name: 'Default model' })`). Run `npx vitest run src/settings src/ai`: PASS.
- [ ] **Step 8:** E2E: `ai-loop.spec.ts` still fills "Default model" (`getByLabel('Default model')` resolves to the combobox input). Run full checks. Remove the backlog entry (the file then holds only its header; keep the header). Commit `feat: model picker with prices when setting up a provider`, push.

---

## Self-review notes

- Spec coverage: §1 → Task 1; §2 → Task 2; §3 → Task 3; §4 → Task 4; §5 → Task 5; §6 → Task 6; cross-cutting rules → Global Constraints.
- Names used across tasks: `STARTER_CODE` / `openWithStarter` / `replaceCode` / `waitForAppReady` (Task 4) are reused by Task 5's e2e. `fitPoseToAspect`, `presetPose(…, aspect)`, `turntablePoses(…, aspect)` (Task 2) are used by Task 3.
