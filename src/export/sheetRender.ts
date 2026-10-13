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
  render?: (opts: Parameters<typeof renderFrames>[0]) => AsyncIterable<ImageData>
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
