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
