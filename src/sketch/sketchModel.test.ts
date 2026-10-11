import {
  dimLabel,
  drawSketch,
  emptySketch,
  formatMm,
  hitItem,
  SKETCH_SIZE,
  sketchReducer,
  type Ctx2D,
  type SketchItem,
} from './sketchModel'

const line: SketchItem = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }
const stroke: SketchItem = { kind: 'stroke', points: [{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 100 }] }

describe('sketchReducer', () => {
  it('adds, undoes and clears, and a clear can be undone', () => {
    let s = sketchReducer(emptySketch, { type: 'add', item: line })
    s = sketchReducer(s, { type: 'add', item: stroke })
    expect(s.items).toEqual([line, stroke])
    s = sketchReducer(s, { type: 'undo' })
    expect(s.items).toEqual([line])
    s = sketchReducer(s, { type: 'clear' })
    expect(s.items).toEqual([])
    s = sketchReducer(s, { type: 'undo' })
    expect(s.items).toEqual([line])
  })

  it('erases the item under the pointer, undoably', () => {
    let s = sketchReducer(sketchReducer(emptySketch, { type: 'add', item: line }), { type: 'add', item: stroke })
    s = sketchReducer(s, { type: 'erase', at: { x: 50, y: 4 } })
    expect(s.items).toEqual([stroke])
    expect(sketchReducer(s, { type: 'undo' }).items).toEqual([line, stroke])
  })

  it('ignores erasing empty space and undoing nothing', () => {
    const s = sketchReducer(emptySketch, { type: 'add', item: line })
    expect(sketchReducer(s, { type: 'erase', at: { x: 300, y: 300 } })).toBe(s)
    expect(sketchReducer(emptySketch, { type: 'undo' })).toBe(emptySketch)
  })
})

it('hit-tests strokes along their segments', () => {
  expect(hitItem(stroke, { x: 50, y: 75 })).toBe(true)
  expect(hitItem(stroke, { x: 80, y: 75 })).toBe(false)
})

describe('dimension labels', () => {
  it('formats millimetres with the unit', () => {
    expect(formatMm(40)).toBe('40 mm')
    expect(formatMm(2.5)).toBe('2.5 mm')
    expect(formatMm(1 / 3)).toBe('0.33 mm')
  })

  it('sits above a horizontal dimension, whichever way it was drawn', () => {
    expect(dimLabel({ x: 0, y: 0 }, { x: 100, y: 0 }, 40)).toEqual({ x: 50, y: -14, angle: 0, text: '40 mm' })
    expect(dimLabel({ x: 100, y: 0 }, { x: 0, y: 0 }, 40)).toMatchObject({ x: 50, y: -14, text: '40 mm' })
  })

  it('turns with a vertical dimension so it still reads upright', () => {
    const label = dimLabel({ x: 0, y: 0 }, { x: 0, y: 100 }, 25)
    expect(label.angle).toBeCloseTo(Math.PI / 2)
    expect(label.x).toBeCloseTo(14)
    expect(label.y).toBeCloseTo(50)
  })
})

type Op = { op: string; style?: string; args?: unknown[] }

function recordingCtx(): { ctx: Ctx2D; ops: Op[] } {
  const ops: Op[] = []
  const ctx: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  }
  const noop = () => {}
  Object.assign(ctx, {
    fillRect: (...args: unknown[]) => ops.push({ op: 'fillRect', style: String(ctx.fillStyle), args }),
    stroke: () => ops.push({ op: 'stroke', style: String(ctx.strokeStyle) }),
    fillText: (...args: unknown[]) => ops.push({ op: 'fillText', style: String(ctx.fillStyle), args }),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
  })
  return { ctx: ctx as unknown as Ctx2D, ops }
}

it('draws the ground, the grid, ink strokes and accent dimensions from the given tokens', () => {
  const { ctx, ops } = recordingCtx()
  const dim: SketchItem = { kind: 'dim', a: { x: 0, y: 200 }, b: { x: 100, y: 200 }, mm: 40 }
  drawSketch(ctx, [line, dim], { ground: 'GROUND', grid: 'GRID', ink: 'INK', accent: 'ACCENT' })
  expect(ops[0]).toEqual({ op: 'fillRect', style: 'GROUND', args: [0, 0, SKETCH_SIZE.width, SKETCH_SIZE.height] })
  expect(ops.filter((o) => o.op === 'stroke').map((o) => o.style)).toEqual(['GRID', 'INK', 'ACCENT'])
  expect(ops.find((o) => o.op === 'fillText')).toEqual({ op: 'fillText', style: 'ACCENT', args: ['40 mm', 0, 0] })
})
