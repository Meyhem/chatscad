export interface Point {
  x: number
  y: number
}

export type SketchItem =
  | { kind: 'stroke'; points: Point[] }
  | { kind: 'line'; a: Point; b: Point }
  | { kind: 'dim'; a: Point; b: Point; mm: number }

export type SketchTool = 'pen' | 'line' | 'size' | 'erase'

export interface SketchResult {
  items: SketchItem[]
  note: string
}

/** Logical canvas size: the PhoneSketch screen's 3 : 4 drawing area. */
export const SKETCH_SIZE = { width: 600, height: 800 } as const
export const GRID_STEP = 40
export const ERASE_TOLERANCE = 12
export const SKETCH_FONT = '600 15px "JetBrains Mono", monospace'
const LABEL_OFFSET = 14
const TICK = 8

export interface SketchState {
  items: SketchItem[]
  undo: SketchItem[][]
}

export type SketchAction =
  | { type: 'add'; item: SketchItem }
  | { type: 'erase'; at: Point }
  | { type: 'undo' }
  | { type: 'clear' }

export const emptySketch: SketchState = { items: [], undo: [] }

export function sketchReducer(state: SketchState, action: SketchAction): SketchState {
  switch (action.type) {
    case 'add':
      return { items: [...state.items, action.item], undo: [...state.undo, state.items] }
    case 'erase': {
      const items = state.items.filter((item) => !hitItem(item, action.at))
      return items.length === state.items.length ? state : { items, undo: [...state.undo, state.items] }
    }
    case 'clear':
      return state.items.length === 0 ? state : { items: [], undo: [...state.undo, state.items] }
    case 'undo':
      return state.undo.length === 0 ? state : { items: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) }
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function hitItem(item: SketchItem, p: Point, tolerance = ERASE_TOLERANCE): boolean {
  if (item.kind === 'stroke') {
    return item.points.some((q, i) => distanceToSegment(p, q, item.points[i + 1] ?? q) <= tolerance)
  }
  return distanceToSegment(p, item.a, item.b) <= tolerance
}

export function formatMm(mm: number): string {
  return `${Number(mm.toFixed(2))} mm`
}

/** Where a dimension's label goes: beside the middle of the line, rotated so it never reads upside down. */
export function dimLabel(a: Point, b: Point, mm: number): { x: number; y: number; angle: number; text: string } {
  let angle = Math.atan2(b.y - a.y, b.x - a.x)
  if (angle > Math.PI / 2) angle -= Math.PI
  if (angle <= -Math.PI / 2) angle += Math.PI
  return {
    x: (a.x + b.x) / 2 + Math.sin(angle) * LABEL_OFFSET,
    y: (a.y + b.y) / 2 - Math.cos(angle) * LABEL_OFFSET,
    angle,
    text: formatMm(mm),
  }
}

export interface SketchColors {
  ground: string
  grid: string
  ink: string
  accent: string
}

export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
  | 'fillText'
>

function drawDimension(ctx: Ctx2D, item: Extract<SketchItem, { kind: 'dim' }>, color: string): void {
  const { a, b, mm } = item
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = (-(b.y - a.y) / len) * TICK
  const ny = ((b.x - a.x) / len) * TICK
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.moveTo(a.x - nx, a.y - ny)
  ctx.lineTo(a.x + nx, a.y + ny)
  ctx.moveTo(b.x - nx, b.y - ny)
  ctx.lineTo(b.x + nx, b.y + ny)
  ctx.stroke()
  const label = dimLabel(a, b, mm)
  ctx.save()
  ctx.translate(label.x, label.y)
  ctx.rotate(label.angle)
  ctx.fillStyle = color
  ctx.font = SKETCH_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label.text, 0, 0)
  ctx.restore()
}

export function drawSketch(
  ctx: Ctx2D,
  items: readonly SketchItem[],
  colors: SketchColors,
  size: { width: number; height: number } = SKETCH_SIZE,
): void {
  ctx.fillStyle = colors.ground
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = GRID_STEP; x < size.width; x += GRID_STEP) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, size.height)
  }
  for (let y = GRID_STEP; y < size.height; y += GRID_STEP) {
    ctx.moveTo(0, y)
    ctx.lineTo(size.width, y)
  }
  ctx.stroke()

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const item of items) {
    if (item.kind === 'dim') {
      drawDimension(ctx, item, colors.accent)
      continue
    }
    const points = item.kind === 'stroke' ? item.points : [item.a, item.b]
    ctx.strokeStyle = colors.ink
    ctx.lineWidth = 2.5
    ctx.beginPath()
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y)
    ctx.stroke()
  }
}
