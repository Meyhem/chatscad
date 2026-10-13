# Dimensioned Views Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Drawing" tab in the export dialog that saves one PNG sheet with the front, top and right views of the model drawn to one scale and dimensioned, plus an iso view for context, a scale bar and the overall size.

**Architecture:** `CameraPose` gains an optional `ortho` frustum, and `glFrameRenderer` draws such poses with an `OrthographicCamera`. A pure module (`src/export/sheet.ts`) lays out the sheet, picks one pixels-per-millimetre scale for all orthographic views, and computes every dimension line from the bounding box. `src/export/sheetRender.ts` renders the four views through the existing `renderFrames` and draws the sheet onto a 2D canvas: frames, view labels, dimension lines with arrows, caption and scale bar. `DrawingTab` gates on `selectCanExport` like STL export.

**Tech Stack:** React 19, TypeScript, Zustand, three (WebGL), 2D canvas, Vitest + Testing Library (jsdom), Playwright against the real OpenSCAD WASM with the CSP active.

**Spec:** `docs/BACKLOG.md`, section "Dimensioned views export" (removed from the backlog in the last task; the behaviour bullets are copied below).

Spec behaviour, verbatim:

- One image (PNG) or page (PDF/SVG) with the standard orthographic views laid out in a grid, plus an isometric view for context. Each view is labelled ("Front", "Top", "Right", "Iso").
- Orthographic views use an orthographic camera, so lengths on screen are true to scale; the sheet states the scale or shows a scale bar.
- Every orthographic view carries dimension lines with arrows and values for the two axes it shows (for example width and height on the front view), in mm with units on every number ("20 mm"). The overall bounding box ("20 × 20 × 10 mm") appears in the sheet's caption.
- Export is allowed only when the current code is rendered and the render is ok, like STL export.
- Colours, fonts and line weights come from the design tokens, with a light background that prints well.

## Global Constraints

- TDD: write the failing test first and watch it fail. Tests that read the filesystem start with `// @vitest-environment node`.
- Tokens only: no hex colours and no Tailwind palette classes in `src/`. Never edit `src/styles/tokens.css` by hand; change `design/tokens.json` and run `npm run tokens`.
- Copy: sentence case, units on every number ("20 mm", "2339 × 1654 px"), the `×` sign, errors say what failed, no exclamation marks or emoji.
- CSP stays strict: fonts are the self-hosted ones already loaded; no new network requests. No new dependencies.
- All asset URLs work under `BASE_PATH` (this feature adds none).
- After each task: `npm run typecheck`, `npm test`, `npm run e2e` all pass, then commit and push `main` (conventional message, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never push with failing checks.

## Decisions

- **PNG only.** The spec allows "one image (PNG) or page (PDF/SVG)". PNG reuses `imageDataToPng` and `saveFile` and needs no dependency. PDF or SVG can follow later.
- **One sheet size:** A4 landscape at 200 dpi, `2339 × 1654 px`. No size picker.
- **Third-angle layout**, 2 × 2 grid: Top over Front, Right beside Front, Iso in the free top-right cell.
- **Scale bar, not a ratio.** A PNG has no physical size, so the sheet shows a bar of a round length (1, 2 or 5 × 10ⁿ mm) next to the caption.
- **Line weights and font sizes scale with the sheet** (1 sheet unit = 1 % of its height). The design system has no line-width tokens; colours and font families do come from tokens.
- **Three new fixed tokens**, the same in both themes like `frame-ground`: `sheet-paper`, `sheet-ink`, `sheet-muted`. They keep the sheet light and printable in dark mode.
- **Gate:** the tab uses `selectCanExport` (status ok, and the rendered code and parameters match the editor), which is stricter than the Image tab's "last model that compiled".

## Review Focus

1. **Flat or extremely thin models** (an extent of 0 mm on one axis): the scale stays finite, the label reads "0 mm", and nothing divides by zero. Test in Task 2.
2. **Models far from the origin** (bounds from 1000 mm to 1040 mm): every view is still centred in its cell, and the dimension lines sit on the model's edges. Test in Task 2.
3. **Long or awkward lengths** ("123.45 mm" next to "0.5 mm"): every dimension line and label stays inside its own cell and never runs into a neighbouring view. Test in Task 2.
4. **Dark theme active**: the sheet stays light because it reads only the fixed `sheet-*` tokens, never `--ink` or `--panel`. Test in Task 4.
5. **Code edited after the last render, or a failed render**: the tab says why and offers no Save button, and no sheet is drawn from a stale mesh. Test in Task 4.

---

### Task 1: Orthographic camera poses

**Files:**
- Modify: `src/export/frames.ts`, `src/export/glFrameRenderer.ts`
- Test: `src/export/frames.test.ts`

**Interfaces:**
- Produces:
  - `CameraPose.ortho?: { halfHeight: number }`: when present, the renderer draws with an orthographic camera that shows `2 × halfHeight` mm vertically and `fov` is ignored.
  - `type OrthoView = 'front' | 'top' | 'right'`
  - `orthoPose(bounds: Bounds, view: OrthoView, halfHeight: number): CameraPose`

- [ ] **Step 1: Write the failing tests**

Add to `src/export/frames.test.ts` (extend the imports: `orthoPose` from `./frames`, and `Bounds` from `../render/types`):

```ts
const OFFSET: Bounds = { min: [-10, 5, 0], max: [30, 25, 10] }

it('places orthographic cameras on the axes, looking at the centre of the model', () => {
  const front = orthoPose(OFFSET, 'front', 12)
  expect(front.target).toEqual([10, 15, 5])
  expect(front.position[0]).toBe(10)
  expect(front.position[1]).toBeLessThan(5)
  expect(front.position[2]).toBe(5)
  expect(front.up).toBeUndefined()
  expect(front.ortho).toEqual({ halfHeight: 12 })

  const top = orthoPose(OFFSET, 'top', 12)
  expect(top.position.slice(0, 2)).toEqual([10, 15])
  expect(top.position[2]).toBeGreaterThan(10)
  expect(top.up).toEqual([0, 1, 0])

  const right = orthoPose(OFFSET, 'right', 12)
  expect(right.position[0]).toBeGreaterThan(30)
  expect(right.position.slice(1)).toEqual([15, 5])
})

it('keeps the camera clear of a model that is flat or tiny', () => {
  const flat: Bounds = { min: [0, 0, 0], max: [0, 0, 0] }
  const pose = orthoPose(flat, 'front', 1)
  expect(pose.position[1]).toBeLessThan(0)
  expect(Number.isFinite(pose.position[1])).toBe(true)
})

it('hands orthographic poses to the renderer unchanged', async () => {
  const pose = orthoPose(mesh.bounds, 'top', 7)
  for await (const _ of renderFrames({ mesh, size: [64, 32], background: null, cameras: [pose] })) {
    // drain
  }
  expect(renderers.at(-1)!.render).toHaveBeenCalledWith(pose)
})
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/export/frames.test.ts`
Expected: FAIL, because `orthoPose` is not exported.

- [ ] **Step 3: Implement `orthoPose`**

In `src/export/frames.ts`, add `ortho` to `CameraPose`:

```ts
  /** Draw with an orthographic camera showing 2 × halfHeight mm vertically; `fov` is ignored. */
  ortho?: { halfHeight: number }
```

Below `presetPose`, add:

```ts
export type OrthoView = Exclude<PresetView, 'iso'>

/** An orthographic camera on an axis through the centre of `bounds`, showing 2 × `halfHeight` mm vertically. */
export function orthoPose(bounds: Bounds, view: OrthoView, halfHeight: number): CameraPose {
  const { min, max } = bounds
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  // Far enough to stay outside the model; with no perspective the distance changes nothing else.
  const d = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]), 1) * 2
  const [tx, ty, tz] = target
  const ortho = { halfHeight }
  switch (view) {
    case 'front':
      return { position: [tx, ty - d, tz], target, ortho }
    case 'top':
      return { position: [tx, ty, tz + d], target, up: [0, 1, 0], ortho }
    case 'right':
      return { position: [tx + d, ty, tz], target, ortho }
  }
}
```

- [ ] **Step 4: Teach the renderer the orthographic camera**

In `src/export/glFrameRenderer.ts`, add `OrthographicCamera` to the `three` import, create it next to the perspective camera:

```ts
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000)
```

and replace the body of `render(pose)` up to `renderer.render(...)` with:

```ts
    render(pose) {
      const cam = pose.ortho ? ortho : camera
      cam.up.set(...(pose.up ?? [0, 0, 1]))
      cam.position.set(...pose.position)
      cam.lookAt(...pose.target)
      const distance = cam.position.distanceTo(new Vector3(...pose.target))
      cam.near = Math.max(distance / 1000, 0.01)
      cam.far = distance * 100
      if (pose.ortho) {
        const halfWidth = pose.ortho.halfHeight * (width / height)
        ortho.left = -halfWidth
        ortho.right = halfWidth
        ortho.top = pose.ortho.halfHeight
        ortho.bottom = -pose.ortho.halfHeight
      } else {
        camera.fov = pose.fov ?? FRAME_FOV
      }
      cam.updateProjectionMatrix()
      renderer.render(scene, cam)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return new ImageData(flipRows(pixels, width, height), width, height)
    },
```

The renderer has no unit test (jsdom has no WebGL). The orthographic path is proven by the Task 4 end-to-end test, which checks that the front view shows the model.

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src/export/frames.test.ts`
Expected: PASS.

- [ ] **Step 6: Full checks and commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all pass. The existing image, turntable and review e2e tests show the perspective path is unchanged.

```bash
git add src/export/frames.ts src/export/glFrameRenderer.ts src/export/frames.test.ts
git commit -m "feat: orthographic camera poses for exported frames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: Sheet layout and dimension geometry

**Files:**
- Create: `src/export/sheet.ts`, `src/export/sheet.test.ts`
- Modify: `src/render/dims.ts` (add `formatLength`)
- Test: `src/render/dims.test.ts` (the `formatLength` case)

**Interfaces:**
- Consumes: `orthoPose`, `presetPose`, `OrthoView`, `CameraPose` from Task 1.
- Produces (all from `src/export/sheet.ts` unless noted):
  - `formatLength(mm: number): string` in `src/render/dims.ts`, for example `"40 mm"` or `"12.5 mm"`.
  - `type SheetView = 'top' | 'iso' | 'front' | 'right'`; `SHEET_VIEWS: SheetView[]` (`['top', 'iso', 'front', 'right']`, row by row); `SHEET_LABELS: Record<SheetView, string>`
  - `SHEET_SIZE: [number, number]` = `[2339, 1654]`
  - `VIEW_AXES: Record<OrthoView, [number, number]>`
  - `type Point = [number, number]`; `interface Rect { x: number; y: number; w: number; h: number }`
  - `interface SheetLayout { size: [number, number]; unit: number; cells: Record<SheetView, Rect>; images: Record<SheetView, Rect>; pxPerMm: number; caption: Rect }`
  - `interface Dimension { from: Point; to: Point; extensions: [Point, Point][]; label: string; labelAt: Point; vertical: boolean }`
  - `sheetLayout(bounds: Bounds, size: [number, number]): SheetLayout`
  - `sheetPoses(bounds: Bounds, layout: SheetLayout): CameraPose[]`, in `SHEET_VIEWS` order
  - `project(view: OrthoView, p: Vec3, bounds: Bounds, layout: SheetLayout): Point`
  - `dimensionsFor(view: OrthoView, bounds: Bounds, layout: SheetLayout): Dimension[]`: `[horizontal, vertical]`
  - `niceLength(maxMm: number): number`
  - `scaleBarLength(layout: SheetLayout): number` (mm)
  - `sheetCaption(bounds: Bounds): string`

- [ ] **Step 1: Write the failing tests**

Create `src/export/sheet.test.ts`:

```ts
import type { Bounds } from '../render/types'
import { orthoPose, presetPose } from './frames'
import {
  dimensionsFor,
  niceLength,
  project,
  scaleBarLength,
  sheetCaption,
  sheetLayout,
  sheetPoses,
  SHEET_SIZE,
  SHEET_VIEWS,
  type Point,
  type Rect,
} from './sheet'

const BOX: Bounds = { min: [-10, 5, 0], max: [30, 25, 10] } // 40 × 20 × 10 mm, off the origin
const inside = ([x, y]: Point, r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

it('lays out four equal cells in a 2 × 2 grid above the caption, inside the sheet', () => {
  const l = sheetLayout(BOX, SHEET_SIZE)
  const [w, h] = SHEET_SIZE
  expect(SHEET_VIEWS).toEqual(['top', 'iso', 'front', 'right'])
  expect(l.cells.top.x).toBeLessThan(l.cells.iso.x)
  expect(l.cells.top.y).toBeLessThan(l.cells.front.y)
  expect(l.cells.front.x).toBe(l.cells.top.x)
  expect(l.cells.right.y).toBe(l.cells.front.y)
  for (const v of SHEET_VIEWS) {
    const c = l.cells[v]
    expect(c.x).toBeGreaterThan(0)
    expect(c.x + c.w).toBeLessThan(w)
    expect(c.y + c.h).toBeLessThan(l.caption.y)
    expect(l.images[v].w).toBe(l.images.front.w)
    expect(l.images[v].h).toBe(l.images.front.h)
    expect(Number.isInteger(l.images[v].w) && Number.isInteger(l.images[v].h)).toBe(true)
  }
  expect(l.caption.y + l.caption.h).toBeLessThan(h)
})

it('uses one scale for all orthographic views, set by the view that needs the most room', () => {
  const l = sheetLayout(BOX, SHEET_SIZE)
  // Front (40 × 10) and top (40 × 20) are both limited by the 40 mm width.
  expect(l.pxPerMm).toBeCloseTo((0.9 * l.images.front.w) / 40)
})

it('renders each view at the image size, orthographic at the sheet scale and iso in perspective', () => {
  const l = sheetLayout(BOX, SHEET_SIZE)
  const { w, h } = l.images.front
  const half = h / (2 * l.pxPerMm)
  expect(sheetPoses(BOX, l)).toEqual([orthoPose(BOX, 'top', half), presetPose(BOX, 'iso', w / h), orthoPose(BOX, 'front', half), orthoPose(BOX, 'right', half)])
})

it('projects the model centre to the image centre and maps the view axes to right and up', () => {
  const l = sheetLayout(BOX, SHEET_SIZE)
  const img = l.images.front
  expect(project('front', [10, 15, 5], BOX, l)).toEqual([img.x + img.w / 2, img.y + img.h / 2])
  const [fx, fy] = project('front', [11, 15, 6], BOX, l)
  expect(fx).toBeGreaterThan(img.x + img.w / 2) // +X runs right
  expect(fy).toBeLessThan(img.y + img.h / 2) // +Z runs up
  const [rx] = project('right', [10, 16, 5], BOX, l)
  expect(rx).toBeGreaterThan(l.images.right.x + l.images.right.w / 2) // +Y runs right seen from +X
  const [, ty] = project('top', [10, 16, 5], BOX, l)
  expect(ty).toBeLessThan(l.images.top.y + l.images.top.h / 2) // +Y runs up seen from above
})

it('dimensions the two axes each view shows, at true scale, inside its cell', () => {
  const l = sheetLayout(BOX, SHEET_SIZE)
  const expected = { front: ['40 mm', '10 mm'], top: ['40 mm', '20 mm'], right: ['20 mm', '10 mm'] } as const
  for (const view of ['front', 'top', 'right'] as const) {
    const [horizontal, vertical] = dimensionsFor(view, BOX, l)
    expect([horizontal.label, vertical.label]).toEqual(expected[view])
    expect(horizontal.vertical).toBe(false)
    expect(vertical.vertical).toBe(true)
    expect(horizontal.from[1]).toBe(horizontal.to[1])
    expect(vertical.from[0]).toBe(vertical.to[0])
    expect(Math.abs(horizontal.to[0] - horizontal.from[0])).toBeCloseTo(parseFloat(horizontal.label) * l.pxPerMm)
    expect(Math.abs(vertical.to[1] - vertical.from[1])).toBeCloseTo(parseFloat(vertical.label) * l.pxPerMm)
    for (const d of [horizontal, vertical]) {
      for (const p of [d.from, d.to, d.labelAt, ...d.extensions.flat()]) expect(inside(p, l.cells[view])).toBe(true)
    }
  }
})

it('puts the dimension lines on the model edges, however far the model is from the origin', () => {
  const far: Bounds = { min: [1000, 1000, 1000], max: [1040, 1020, 1010] }
  const l = sheetLayout(far, SHEET_SIZE)
  const [horizontal, vertical] = dimensionsFor('front', far, l)
  const [left, bottom] = project('front', far.min, far, l)
  const [right, top] = project('front', far.max, far, l)
  expect([horizontal.from[0], horizontal.to[0]]).toEqual([left, right])
  expect([vertical.from[1], vertical.to[1]]).toEqual([bottom, top])
  expect(inside(horizontal.labelAt, l.cells.front)).toBe(true)
})

it('keeps a flat model and very uneven lengths finite and inside their cells', () => {
  const flat: Bounds = { min: [0, 0, 0], max: [123.45, 0.5, 0] }
  const l = sheetLayout(flat, SHEET_SIZE)
  expect(Number.isFinite(l.pxPerMm)).toBe(true)
  const labels = (['front', 'top', 'right'] as const).flatMap((v) => dimensionsFor(v, flat, l).map((d) => d.label))
  expect(labels).toEqual(['123.45 mm', '0 mm', '123.45 mm', '0.5 mm', '0.5 mm', '0 mm'])
  for (const view of ['front', 'top', 'right'] as const) {
    for (const d of dimensionsFor(view, flat, l)) {
      for (const p of [d.from, d.to, d.labelAt, ...d.extensions.flat()]) {
        expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true)
        expect(inside(p, l.cells[view])).toBe(true)
      }
    }
  }
})

it('picks a round scale bar length', () => {
  expect(niceLength(37)).toBe(20)
  expect(niceLength(10)).toBe(10)
  expect(niceLength(1.9)).toBe(1)
  expect(niceLength(0.3)).toBeCloseTo(0.2)
  expect(niceLength(5000)).toBe(5000)
  const l = sheetLayout(BOX, SHEET_SIZE)
  expect(scaleBarLength(l)).toBe(niceLength(l.images.front.w / l.pxPerMm / 4))
})

it('captions the sheet with the overall size and how it is drawn', () => {
  expect(sheetCaption(BOX)).toBe('40 × 20 × 10 mm overall · third-angle projection · front, top and right to one scale')
})
```

Add to `src/render/dims.test.ts` (and add `formatLength` to its import from `./dims`):

```ts
it('formats one length in mm', () => {
  expect(formatLength(40)).toBe('40 mm')
  expect(formatLength(12.5)).toBe('12.5 mm')
  expect(formatLength(0)).toBe('0 mm')
})
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/export/sheet.test.ts src/render/dims.test.ts`
Expected: FAIL, because `./sheet` does not exist and `formatLength` is not exported.

- [ ] **Step 3: Add `formatLength`**

In `src/render/dims.ts`, below `fmt`:

```ts
/** One length: "40 mm", "12.5 mm". */
export const formatLength = (mm: number) => `${fmt(mm)} mm`
```

- [ ] **Step 4: Implement `src/export/sheet.ts`**

```ts
import { formatDims, formatLength } from '../render/dims'
import type { Bounds, Vec3 } from '../render/types'
import { orthoPose, presetPose, type CameraPose, type OrthoView } from './frames'

export type SheetView = 'top' | 'iso' | 'front' | 'right'
/** Third-angle projection, row by row: top above front, right beside front, iso in the free corner. */
export const SHEET_VIEWS: SheetView[] = ['top', 'iso', 'front', 'right']
export const SHEET_LABELS: Record<SheetView, string> = { top: 'Top', iso: 'Iso', front: 'Front', right: 'Right' }
const ORTHO_VIEWS: OrthoView[] = ['front', 'top', 'right']

/** A4 landscape at 200 dpi. */
export const SHEET_SIZE: [number, number] = [2339, 1654]

/** World axes (0 = X, 1 = Y, 2 = Z) that run right and up in each orthographic view. */
export const VIEW_AXES: Record<OrthoView, [number, number]> = { front: [0, 2], top: [0, 1], right: [1, 2] }

export type Point = [number, number]
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SheetLayout {
  size: [number, number]
  /** 1 % of the sheet height; fonts, gaps and line widths scale with it. */
  unit: number
  cells: Record<SheetView, Rect>
  /** Where each view's rendered image goes; all four are the same whole-pixel size. */
  images: Record<SheetView, Rect>
  /** Sheet pixels per millimetre, shared by the three orthographic views. */
  pxPerMm: number
  caption: Rect
}

export interface Dimension {
  /** Ends of the dimension line, with an arrow at each. */
  from: Point
  to: Point
  /** Lines from the model's edges out past the dimension line. */
  extensions: [Point, Point][]
  label: string
  /** Centre of the label; vertical labels are turned to read upwards. */
  labelAt: Point
  vertical: boolean
}

const MIN_EXTENT = 0.01 // mm; keeps the scale finite for a flat model
const FILL = 0.9 // share of the image box the largest view may fill

const size = (b: Bounds, axis: number) => b.max[axis] - b.min[axis]
const centre = (b: Bounds): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]

export function sheetLayout(bounds: Bounds, [width, height]: [number, number]): SheetLayout {
  const unit = height / 100
  const margin = Math.round(4 * unit)
  const captionH = Math.round(7 * unit)
  const labelH = Math.round(4 * unit)
  const dimSpace = Math.round(6 * unit)
  const cellW = Math.floor((width - 3 * margin) / 2)
  const cellH = Math.floor((height - 4 * margin - captionH) / 2)
  const imageW = cellW - 2 * dimSpace
  const imageH = cellH - labelH - dimSpace
  const cells = {} as Record<SheetView, Rect>
  const images = {} as Record<SheetView, Rect>
  SHEET_VIEWS.forEach((view, i) => {
    const x = margin + (i % 2) * (cellW + margin)
    const y = margin + Math.floor(i / 2) * (cellH + margin)
    cells[view] = { x, y, w: cellW, h: cellH }
    images[view] = { x: x + dimSpace, y: y + labelH, w: imageW, h: imageH }
  })
  const pxPerMm = Math.min(
    ...ORTHO_VIEWS.map((view) => {
      const [right, up] = VIEW_AXES[view]
      return Math.min((FILL * imageW) / Math.max(size(bounds, right), MIN_EXTENT), (FILL * imageH) / Math.max(size(bounds, up), MIN_EXTENT))
    }),
  )
  const caption = { x: margin, y: height - margin - captionH, w: width - 2 * margin, h: captionH }
  return { size: [width, height], unit, cells, images, pxPerMm, caption }
}

/** One camera per view in SHEET_VIEWS order, each for an image of `layout.images.*` size. */
export function sheetPoses(bounds: Bounds, layout: SheetLayout): CameraPose[] {
  const { w, h } = layout.images.front
  const halfHeight = h / (2 * layout.pxPerMm)
  return SHEET_VIEWS.map((view) => (view === 'iso' ? presetPose(bounds, 'iso', w / h) : orthoPose(bounds, view, halfHeight)))
}

/** Where a model point lands on the sheet in an orthographic view. */
export function project(view: OrthoView, p: Vec3, bounds: Bounds, layout: SheetLayout): Point {
  const [right, up] = VIEW_AXES[view]
  const c = centre(bounds)
  const img = layout.images[view]
  return [img.x + img.w / 2 + (p[right] - c[right]) * layout.pxPerMm, img.y + img.h / 2 - (p[up] - c[up]) * layout.pxPerMm]
}

/** Width below the view and height to its left, each with extension lines from the model's edges. */
export function dimensionsFor(view: OrthoView, bounds: Bounds, layout: SheetLayout): Dimension[] {
  const [right, up] = VIEW_AXES[view]
  const [left, bottom] = project(view, bounds.min, bounds, layout)
  const [rightX, top] = project(view, bounds.max, bounds, layout)
  const u = layout.unit
  const y = bottom + 2.5 * u
  const x = left - 2.5 * u
  return [
    {
      from: [left, y],
      to: [rightX, y],
      extensions: [
        [[left, bottom + 0.5 * u], [left, y + 0.8 * u]],
        [[rightX, bottom + 0.5 * u], [rightX, y + 0.8 * u]],
      ],
      label: formatLength(size(bounds, right)),
      labelAt: [(left + rightX) / 2, y + 1.6 * u],
      vertical: false,
    },
    {
      from: [x, bottom],
      to: [x, top],
      extensions: [
        [[left - 0.5 * u, bottom], [x - 0.8 * u, bottom]],
        [[left - 0.5 * u, top], [x - 0.8 * u, top]],
      ],
      label: formatLength(size(bounds, up)),
      labelAt: [x - 1.6 * u, (bottom + top) / 2],
      vertical: true,
    },
  ]
}

/** The longest 1, 2 or 5 × 10ⁿ mm that is at most `maxMm`. */
export function niceLength(maxMm: number): number {
  const p = 10 ** Math.floor(Math.log10(maxMm))
  return [5, 2, 1].map((m) => m * p).find((l) => l <= maxMm) ?? p
}

/** About a quarter of a view's width. */
export const scaleBarLength = (layout: SheetLayout) => niceLength(layout.images.front.w / layout.pxPerMm / 4)

export const sheetCaption = (bounds: Bounds) => `${formatDims(bounds)} overall · third-angle projection · front, top and right to one scale`
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src/export/sheet.test.ts`
Expected: PASS. If the "inside its cell" assertions fail for a label, increase `dimSpace` (6 units) rather than move the label into the image box, so dimensions never cover the model.

- [ ] **Step 6: Full checks and commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all pass.

```bash
git add src/export/sheet.ts src/export/sheet.test.ts src/render/dims.ts src/render/dims.test.ts
git commit -m "feat: layout and dimension geometry for the drawing sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Drawing the sheet

**Files:**
- Create: `src/export/sheetRender.ts`, `src/export/sheetRender.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `renderFrames` from `src/export/frames.ts`.
- Produces:
  - `interface SheetColours { paper: string; ink: string; muted: string; fontSans: string; fontMono: string }`
  - `type SheetCanvas`: the subset of `CanvasRenderingContext2D` that `drawSheet` uses.
  - `drawSheet(ctx: SheetCanvas, opts: { layout: SheetLayout; bounds: Bounds; frames: ImageData[]; colours: SheetColours }): void`. `frames` are in `SHEET_VIEWS` order.
  - `renderSheet(opts: { mesh: MeshData; size: [number, number]; colours: SheetColours; render?: typeof renderFrames }): Promise<ImageData>`

- [ ] **Step 1: Write the failing tests**

Create `src/export/sheetRender.test.ts`:

```ts
import type { MeshData } from '../render/types'
import { okResult } from '../test/results'
import { renderFrames } from './frames'
import { scaleBarLength, sheetLayout, sheetPoses, SHEET_SIZE, SHEET_VIEWS, type SheetLayout } from './sheet'
import { drawSheet, renderSheet, type SheetCanvas, type SheetColours } from './sheetRender'

const COLOURS: SheetColours = { paper: 'paper', ink: 'ink', muted: 'muted', fontSans: 'Sans', fontMono: 'Mono' }
const BOUNDS = { min: [-10, 5, 0], max: [30, 25, 10] } as MeshData['bounds']

type Call = [string, ...unknown[]]
function recorder(extra: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const state: Record<string, unknown> = { ...extra }
  const ctx = new Proxy(state, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push([k, ...args])),
    set: (t, k: string, v) => {
      t[k] = v
      calls.push([`set ${k}`, v])
      return true
    },
  })
  return { ctx: ctx as unknown as SheetCanvas, calls }
}
const fakeFrame = (i: number) => ({ width: 1, height: 1, data: new Uint8ClampedArray(4), i }) as unknown as ImageData

function drawn(layout: SheetLayout = sheetLayout(BOUNDS, SHEET_SIZE)) {
  const { ctx, calls } = recorder()
  const frames = SHEET_VIEWS.map((_, i) => fakeFrame(i))
  drawSheet(ctx, { layout, bounds: BOUNDS, frames, colours: COLOURS })
  return { calls, frames, layout }
}

it('paints the paper first, then each view image in its box', () => {
  const { calls, frames, layout } = drawn()
  expect(calls.slice(0, 2)).toEqual([['set fillStyle', 'paper'], ['fillRect', 0, 0, ...SHEET_SIZE]])
  const puts = calls.filter((c) => c[0] === 'putImageData')
  expect(puts).toEqual(SHEET_VIEWS.map((v, i) => ['putImageData', frames[i], Math.round(layout.images[v].x), Math.round(layout.images[v].y)]))
})

it('writes every view label, both dimensions per orthographic view, the caption and the scale bar label', () => {
  const { calls, layout } = drawn()
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
  expect(texts).toEqual([
    'Top',
    'Iso',
    'Front',
    'Right',
    '40 mm',
    '10 mm',
    '40 mm',
    '20 mm',
    '20 mm',
    '10 mm',
    '40 × 20 × 10 mm overall · third-angle projection · front, top and right to one scale',
    `${scaleBarLength(layout)} mm`,
  ])
})

it('draws arrowheads at both ends of every dimension and turns the vertical labels', () => {
  const { calls } = drawn()
  expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(12) // 6 dimensions × 2 arrows
  expect(calls.filter((c) => c[0] === 'rotate')).toEqual([
    ['rotate', -Math.PI / 2],
    ['rotate', -Math.PI / 2],
    ['rotate', -Math.PI / 2],
  ])
})

it('uses only the sheet colours and the token font families', () => {
  const { calls } = drawn()
  const colours = new Set(calls.filter((c) => c[0] === 'set fillStyle' || c[0] === 'set strokeStyle').map((c) => c[1]))
  expect([...colours].sort()).toEqual(['ink', 'muted', 'paper'])
  const fonts = calls.filter((c) => c[0] === 'set font').map((c) => String(c[1]))
  expect(fonts.length).toBeGreaterThan(0)
  for (const f of fonts) expect(f.endsWith(' Sans') || f.endsWith(' Mono')).toBe(true)
})

it('renders the four views at the image size on paper, then returns the whole sheet', async () => {
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  const mesh = { ...r.mesh, bounds: BOUNDS }
  const sheet = { width: SHEET_SIZE[0], height: SHEET_SIZE[1] } as ImageData
  const { ctx, calls } = recorder({ getImageData: () => sheet })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  const render = vi.fn(async function* (_opts: Parameters<typeof renderFrames>[0]) {
    for (let i = 0; i < 4; i++) yield fakeFrame(i)
  })

  await expect(renderSheet({ mesh, size: SHEET_SIZE, colours: COLOURS, render })).resolves.toBe(sheet)
  const layout = sheetLayout(BOUNDS, SHEET_SIZE)
  expect(render).toHaveBeenCalledWith({
    mesh,
    size: [layout.images.front.w, layout.images.front.h],
    background: 'paper',
    cameras: sheetPoses(BOUNDS, layout),
  })
  expect(calls.filter((c) => c[0] === 'putImageData')).toHaveLength(4)
})

it('says what failed when the browser has no 2D canvas', async () => {
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const render = vi.fn(async function* () {
    for (let i = 0; i < 4; i++) yield fakeFrame(i)
  })
  await expect(renderSheet({ mesh: r.mesh, size: SHEET_SIZE, colours: COLOURS, render })).rejects.toThrow('The browser has no 2D canvas to draw the sheet')
})

afterEach(() => vi.restoreAllMocks())
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/export/sheetRender.test.ts`
Expected: FAIL, because `./sheetRender` does not exist.

- [ ] **Step 3: Implement `src/export/sheetRender.ts`**

```ts
import { formatLength } from '../render/dims'
import type { Bounds, MeshData } from '../render/types'
import { renderFrames } from './frames'
import {
  dimensionsFor,
  scaleBarLength,
  sheetCaption,
  sheetLayout,
  sheetPoses,
  SHEET_LABELS,
  SHEET_VIEWS,
  type Dimension,
  type Point,
  type SheetLayout,
} from './sheet'

/** Token values the sheet is drawn with; fixed sheet colours, so it prints the same in either theme. */
export interface SheetColours {
  paper: string
  ink: string
  muted: string
  fontSans: string
  fontMono: string
}

export type SheetCanvas = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'putImageData'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'fillText'
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
>

function line(ctx: SheetCanvas, a: Point, b: Point) {
  ctx.beginPath()
  ctx.moveTo(...a)
  ctx.lineTo(...b)
  ctx.stroke()
}

// A filled arrowhead with its tip at `tip`, pointing away from `from`.
function arrow(ctx: SheetCanvas, tip: Point, from: Point, size: number) {
  const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1
  const ux = (tip[0] - from[0]) / len
  const uy = (tip[1] - from[1]) / len
  const bx = tip[0] - ux * size
  const by = tip[1] - uy * size
  const half = size * 0.35
  ctx.beginPath()
  ctx.moveTo(...tip)
  ctx.lineTo(bx - uy * half, by + ux * half)
  ctx.lineTo(bx + uy * half, by - ux * half)
  ctx.closePath()
  ctx.fill()
}

function drawDimension(ctx: SheetCanvas, d: Dimension, unit: number) {
  for (const [a, b] of d.extensions) line(ctx, a, b)
  line(ctx, d.from, d.to)
  arrow(ctx, d.from, d.to, 1.2 * unit)
  arrow(ctx, d.to, d.from, 1.2 * unit)
  ctx.save()
  ctx.translate(...d.labelAt)
  if (d.vertical) ctx.rotate(-Math.PI / 2)
  ctx.fillText(d.label, 0, 0)
  ctx.restore()
}

/** Paper, the four view images, labels, dimension lines, caption and scale bar. `frames` follow SHEET_VIEWS. */
export function drawSheet(
  ctx: SheetCanvas,
  { layout, bounds, frames, colours }: { layout: SheetLayout; bounds: Bounds; frames: ImageData[]; colours: SheetColours },
) {
  const { unit } = layout
  ctx.fillStyle = colours.paper
  ctx.fillRect(0, 0, ...layout.size)
  SHEET_VIEWS.forEach((view, i) => {
    const img = layout.images[view]
    ctx.putImageData(frames[i], Math.round(img.x), Math.round(img.y))
  })

  ctx.fillStyle = colours.ink
  ctx.strokeStyle = colours.ink
  ctx.lineWidth = Math.max(1, Math.round(unit * 0.15))
  ctx.textBaseline = 'middle'

  ctx.font = `600 ${Math.round(2.2 * unit)}px ${colours.fontSans}`
  ctx.textAlign = 'left'
  for (const view of SHEET_VIEWS) {
    const cell = layout.cells[view]
    ctx.fillText(SHEET_LABELS[view], cell.x, cell.y + 1.5 * unit)
  }

  ctx.font = `500 ${Math.round(1.6 * unit)}px ${colours.fontMono}`
  ctx.textAlign = 'center'
  for (const view of ['front', 'top', 'right'] as const) {
    for (const d of dimensionsFor(view, bounds, layout)) drawDimension(ctx, d, unit)
  }

  const cap = layout.caption
  const mid = cap.y + cap.h / 2
  ctx.font = `500 ${Math.round(1.6 * unit)}px ${colours.fontSans}`
  ctx.fillStyle = colours.muted
  ctx.textAlign = 'left'
  ctx.fillText(sheetCaption(bounds), cap.x, mid)

  const barMm = scaleBarLength(layout)
  const barPx = barMm * layout.pxPerMm
  const barRight = cap.x + cap.w
  ctx.fillStyle = colours.ink
  ctx.textAlign = 'right'
  ctx.fillText(formatLength(barMm), barRight - barPx - unit, mid)
  ctx.fillRect(barRight - barPx, mid - 0.4 * unit, barPx, 0.8 * unit)
}

function sheetContext(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height).getContext('2d') as unknown as CanvasRenderingContext2D | null
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d')
}

/** Renders the four views offscreen and draws the whole sheet at `size`. */
export async function renderSheet({
  mesh,
  size,
  colours,
  render = renderFrames,
}: {
  mesh: MeshData
  size: [number, number]
  colours: SheetColours
  render?: typeof renderFrames
}): Promise<ImageData> {
  const layout = sheetLayout(mesh.bounds, size)
  const { w, h } = layout.images.front
  const frames: ImageData[] = []
  for await (const frame of render({ mesh, size: [w, h], background: colours.paper, cameras: sheetPoses(mesh.bounds, layout) })) frames.push(frame)
  const ctx = sheetContext(...size)
  if (!ctx) throw new Error('The browser has no 2D canvas to draw the sheet')
  drawSheet(ctx, { layout, bounds: mesh.bounds, frames, colours })
  return ctx.getImageData(0, 0, ...size)
}
```

Note: the test's `render` mock is typed as `typeof renderFrames`. If `vi.fn(async function* ...)` does not satisfy that type, type the parameter as `render?: (opts: Parameters<typeof renderFrames>[0]) => AsyncIterable<ImageData>` (the same shape `src/agent/frames.ts` uses for `FrameDeps.renderFrames`).

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/export/sheetRender.test.ts`
Expected: PASS.

- [ ] **Step 5: Full checks and commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all pass.

```bash
git add src/export/sheetRender.ts src/export/sheetRender.test.ts
git commit -m "feat: draw the dimensioned drawing sheet on a 2D canvas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Sheet tokens and the Drawing tab

**Files:**
- Modify: `design/tokens.json`, `src/styles/tokens.css` (regenerated by `npm run tokens`, never by hand), `design/README.md`, `src/export/exportStore.ts`, `src/export/ExportDialog.tsx`, `docs/BACKLOG.md`
- Create: `src/export/tabs/DrawingTab.tsx`, `src/export/tabs/DrawingTab.test.tsx`, `src/export/sheetTokens.test.ts`
- Test: `e2e/export.spec.ts`

**Interfaces:**
- Consumes: `renderSheet`, `SheetColours` (Task 3); `SHEET_SIZE` (Task 2); `selectCanExport` from `src/state/store.ts`; `exportDisabledReason` from `src/export/ExportButtons.tsx`.
- Produces: `DrawingTab(): JSX.Element`; `sheetColours(): SheetColours`; `ExportTab` gains `'drawing'`.

- [ ] **Step 1: Write the failing token test**

Create `src/export/sheetTokens.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs'

const SHEET_TOKENS = ['sheet-paper', 'sheet-ink', 'sheet-muted']

function findToken(node: unknown, name: string): { value: unknown } | undefined {
  if (Array.isArray(node)) return node.map((n) => findToken(n, name)).find(Boolean)
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (o.name === name && 'value' in o) return o as { value: unknown }
    return Object.values(o).map((n) => findToken(n, name)).find(Boolean)
  }
  return undefined
}

it('keeps the drawing colours fixed in both themes, so the sheet prints the same in dark mode', () => {
  const json: unknown = JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8'))
  const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
  for (const name of SHEET_TOKENS) {
    expect(typeof findToken(json, name)?.value).toBe('string') // one value, not { dark, light }
    expect(css).toContain(`--${name}:`)
  }
})
```

Run: `npx vitest run src/export/sheetTokens.test.ts`
Expected: FAIL, because the tokens do not exist.

- [ ] **Step 2: Add the tokens**

In `design/tokens.json`, directly after the `frame-ground` entry in the colour `tokens` list, add:

```json
      {
        "name": "sheet-paper",
        "value": "#ffffff",
        "usage": "Paper of the dimensioned drawing export. Fixed in both themes, so the sheet prints the same."
      },
      {
        "name": "sheet-ink",
        "value": "#10151c",
        "usage": "Lines, dimensions, labels and scale bar on the drawing export. Fixed in both themes."
      },
      {
        "name": "sheet-muted",
        "value": "#4d5867",
        "usage": "Caption text on the drawing export. Fixed in both themes."
      },
```

Run `npm run tokens`, then `npx vitest run src/export/sheetTokens.test.ts`. Expected: PASS. (Hex values belong in `design/`, never in `src/`; the generated `tokens.css` is the only exception.)

In `design/README.md`, extend the `tokens.json` row's "Changes from the source" cell: after "…for the agent's review frames;", add "`sheet-paper`, `sheet-ink` and `sheet-muted` for the drawing export;".

- [ ] **Step 3: Write the failing tab tests**

Create `src/export/tabs/DrawingTab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MeshData } from '../../render/types'
import { useAppStore } from '../../state/store'
import { okResult } from '../../test/results'
import { imageDataToPng } from '../png'
import { saveFile } from '../saveFile'
import { SHEET_SIZE } from '../sheet'
import { renderSheet } from '../sheetRender'
import { previewSize } from '../sizes'
import { DrawingTab } from './DrawingTab'

vi.mock('../sheetRender', () => ({
  renderSheet: vi.fn(async (opts: { size: [number, number] }) => ({ width: opts.size[0], height: opts.size[1], data: new Uint8ClampedArray(4) }) as unknown as ImageData),
}))
vi.mock('../png', () => ({ imageDataToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }))
vi.mock('../saveFile', () => ({ saveFile: vi.fn(async () => 'downloaded') }))
vi.mock('../FramePreview', () => ({
  FramePreview: ({ label }: { label: string }) => <div data-testid="frame-preview">{label}</div>,
}))
vi.mock('../../theme/tokens', () => ({ readToken: (name: string) => `token:${name}` }))

const COLOURS = {
  paper: 'token:sheet-paper',
  ink: 'token:sheet-ink',
  muted: 'token:sheet-muted',
  fontSans: 'token:font-sans',
  fontMono: 'token:font-mono',
}

let mesh: MeshData
let stl: ArrayBuffer
beforeEach(() => {
  vi.clearAllMocks()
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  mesh = r.mesh
  stl = r.stl
  useAppStore.setState(
    { ...useAppStore.getInitialState(), mesh, stl, status: 'ok', code: 'cube(20);', renderedCode: 'cube(20);', params: {}, renderedParams: {} },
    true,
  )
})

it('previews the sheet and saves it as a PNG drawn with the fixed sheet tokens', async () => {
  render(<DrawingTab />)
  await waitFor(() => expect(renderSheet).toHaveBeenCalledWith({ mesh, size: previewSize(SHEET_SIZE, 960), colours: COLOURS }))
  expect(screen.getByTestId('frame-preview')).toHaveTextContent('Preview of the drawing')
  expect(screen.getByText('A4 landscape, 2339 × 1654 px')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Save PNG' }))
  await waitFor(() => expect(saveFile).toHaveBeenCalled())
  expect(vi.mocked(renderSheet).mock.calls.at(-1)![0]).toEqual({ mesh, size: SHEET_SIZE, colours: COLOURS })
  expect(imageDataToPng).toHaveBeenCalledWith(expect.objectContaining({ width: 2339, height: 1654 }))
  expect(vi.mocked(saveFile).mock.calls[0][1]).toBe('model-drawing.png')
})

it('refuses a stale render and says why, without drawing anything', () => {
  useAppStore.setState({ code: 'cube(30);', status: 'rendering' })
  render(<DrawingTab />)
  expect(screen.getByText('The drawing needs a current render')).toBeInTheDocument()
  expect(screen.getByText('Wait for the render to finish.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save PNG' })).toBeNull()
  expect(renderSheet).not.toHaveBeenCalled()
})

it('refuses after a failed render', () => {
  useAppStore.setState({ status: 'error' })
  render(<DrawingTab />)
  expect(screen.getByText('Fix the error first, so the file matches the code.')).toBeInTheDocument()
})

it('refuses edited code even while the old render still counts as ok', () => {
  useAppStore.setState({ code: 'cube(30);' })
  render(<DrawingTab />)
  expect(screen.getByText('Wait for the render to finish.')).toBeInTheDocument()
})

it('explains when there is nothing to export', () => {
  useAppStore.setState({ mesh: null })
  render(<DrawingTab />)
  expect(screen.getByText('Nothing to export yet')).toBeInTheDocument()
})

it('says what failed when the preview cannot be drawn', async () => {
  vi.mocked(renderSheet).mockRejectedValueOnce(new Error('The browser has no 2D canvas to draw the sheet'))
  render(<DrawingTab />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not draw the preview: The browser has no 2D canvas to draw the sheet')
})
```

Add one dialog test to `src/export/ExportDialog.test.tsx`, next to the existing tab-switching test:

```tsx
it('offers the Drawing tab right after Image', () => {
  useExportStore.setState({ open: true, tab: 'model' })
  render(<ExportDialog />)
  const names = screen.getAllByRole('tab').map((t) => t.textContent)
  expect(names).toEqual(['Model file', 'Image', 'Drawing', 'Turntable', 'Timelapse', 'Link'])
})
```

(Match that file's existing imports and setup for `useExportStore`, `render` and `ExportDialog`; add any that are missing.)

- [ ] **Step 4: Run the tests to watch them fail**

Run: `npx vitest run src/export/tabs/DrawingTab.test.tsx src/export/ExportDialog.test.tsx`
Expected: FAIL, because `./DrawingTab` does not exist and the dialog has no Drawing tab.

- [ ] **Step 5: Implement the tab and wire it in**

Create `src/export/tabs/DrawingTab.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { formatDims } from '../../render/dims'
import { errorMessage } from '../../render/result'
import { selectCanExport, useAppStore } from '../../state/store'
import { readToken } from '../../theme/tokens'
import { Callout } from '../../ui/Callout'
import { IconDownload } from '../../ui/icons'
import { exportDisabledReason } from '../ExportButtons'
import { FramePreview } from '../FramePreview'
import { imageDataToPng } from '../png'
import { saveFile } from '../saveFile'
import { SHEET_SIZE } from '../sheet'
import { renderSheet, type SheetColours } from '../sheetRender'
import { previewSize } from '../sizes'
import { NothingToExport, TabBody, TabFooter } from './layout'

const PREVIEW_SIZE = previewSize(SHEET_SIZE, 960)

/** Read at draw time. The sheet tokens are fixed in both themes, so the sheet stays light in dark mode. */
export function sheetColours(): SheetColours {
  return {
    paper: readToken('sheet-paper'),
    ink: readToken('sheet-ink'),
    muted: readToken('sheet-muted'),
    fontSans: readToken('font-sans'),
    fontMono: readToken('font-mono'),
  }
}

export function DrawingTab() {
  const mesh = useAppStore((s) => s.mesh)
  const status = useAppStore((s) => s.status)
  const canExport = useAppStore(selectCanExport)
  const [preview, setPreview] = useState<ImageData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mesh || !canExport) return
    let live = true
    renderSheet({ mesh, size: PREVIEW_SIZE, colours: sheetColours() }).then(
      (frame) => live && setPreview(frame),
      (e: unknown) => live && setError(`Could not draw the preview: ${errorMessage(e)}`),
    )
    return () => {
      live = false
    }
  }, [mesh, canExport])

  if (!mesh) return <NothingToExport />
  if (!canExport) {
    return (
      <div className="px-6 py-5">
        <Callout tone="info" title="The drawing needs a current render">
          {exportDisabledReason(status) ?? 'Wait for the render to finish'}.
        </Callout>
      </div>
    )
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const sheet = await renderSheet({ mesh, size: SHEET_SIZE, colours: sheetColours() })
      await saveFile(await imageDataToPng(sheet), 'model-drawing.png')
    } catch (e) {
      setError(`Could not save the PNG: ${errorMessage(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <TabBody>
        <div className="flex min-w-0 flex-col gap-3">
          <FramePreview frame={preview} label="Preview of the drawing" />
          <span className="pc-caption">Front, top and right views to one scale, with an iso view for context.</span>
        </div>
        <div className="flex flex-col gap-4">
          <div className="pc-field">
            <span className="pc-label">Sheet</span>
            <span>
              A4 landscape, {SHEET_SIZE[0]} × {SHEET_SIZE[1]} px
            </span>
          </div>
          <div className="pc-field">
            <span className="pc-label">Overall size</span>
            <span className="pc-mono">{formatDims(mesh.bounds)}</span>
          </div>
        </div>
      </TabBody>
      <TabFooter>
        <span className="min-w-0 flex-1">
          {error && (
            <span role="alert" className="pc-caption text-error">
              {error}
            </span>
          )}
        </span>
        <button type="button" className="pc-btn is-primary" disabled={saving} onClick={() => void save()}>
          <IconDownload className="pc-i" aria-hidden="true" />
          Save PNG
        </button>
      </TabFooter>
    </>
  )
}
```

`getByText('A4 landscape, 2339 × 1654 px')` needs the text in one node. If Testing Library splits it at the `{…}` expressions, build the string first: `` {`A4 landscape, ${SHEET_SIZE[0]} × ${SHEET_SIZE[1]} px`} ``.

In `src/export/exportStore.ts`:

```ts
export type ExportTab = 'model' | 'image' | 'drawing' | 'turntable' | 'timelapse' | 'link'
```

In `src/export/ExportDialog.tsx`, import `DrawingTab` from `./tabs/DrawingTab` and add `{ id: 'drawing', label: 'Drawing', Panel: DrawingTab },` right after the `image` entry in `TABS`.

- [ ] **Step 6: Run the unit tests to watch them pass**

Run: `npx vitest run src/export`
Expected: PASS.

- [ ] **Step 7: Write the end-to-end test**

Add to `e2e/export.spec.ts`. It proves the orthographic renderer draws the model (the bottom-left quadrant, the Front cell, contains filament-coloured pixels) and that the sheet saves at full size under the CSP:

```ts
test('saves a dimensioned drawing with the model in the front view', async ({ page }) => {
  const csp = watchCspViolations(page)
  const dialog = await openExport(page, 'Drawing')
  const preview = dialog.getByRole('img', { name: 'Preview of the drawing' })
  await expect(preview).toBeVisible()
  // The filament is orange (red well above blue); paper and ink are grey, so only the model qualifies.
  const modelPixels = await preview.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const { data } = c.getContext('2d')!.getImageData(0, c.height / 2, c.width / 2, c.height / 2)
    let n = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] - data[i + 2] > 60) n++
    return n
  })
  expect(modelPixels).toBeGreaterThan(100)

  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save PNG' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('model-drawing.png')
  const bytes = await readFile((await file.path())!)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.readUInt32BE(16)).toBe(2339)
  expect(bytes.readUInt32BE(20)).toBe(1654)
  expect(csp).toEqual([])
})
```

Run: `npm run e2e -- export.spec.ts`
Expected: PASS. If `modelPixels` is 0, the orthographic camera from Task 1 is wrong (frustum or near plane). Fix it there and do not loosen the threshold. Both themes' `--filament` is orange (`#e9a23b` dark, `#d4861a` light), so the test holds in either.

- [ ] **Step 8: Remove the backlog entry**

Delete the whole `## Dimensioned views export` section from `docs/BACKLOG.md`.

- [ ] **Step 9: Full checks, look at the sheet, commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all pass.

Open the downloaded `model-drawing.png` from a manual run (`npm run dev`, Share, Drawing, Save PNG) and check by eye that the views are labelled, the arrows point outwards to the extension lines, the labels do not overlap the model, and the vertical labels read upwards.

```bash
git add design/tokens.json design/README.md src/styles/tokens.css src/export/exportStore.ts src/export/ExportDialog.tsx src/export/ExportDialog.test.tsx src/export/tabs/DrawingTab.tsx src/export/tabs/DrawingTab.test.tsx src/export/sheetTokens.test.ts e2e/export.spec.ts docs/BACKLOG.md
git commit -m "feat: Drawing export tab with dimensioned front, top, right and iso views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
