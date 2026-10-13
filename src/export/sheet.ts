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
        [
          [left, bottom + 0.5 * u],
          [left, y + 0.8 * u],
        ],
        [
          [rightX, bottom + 0.5 * u],
          [rightX, y + 0.8 * u],
        ],
      ],
      label: formatLength(size(bounds, right)),
      labelAt: [(left + rightX) / 2, y + 1.6 * u],
      vertical: false,
    },
    {
      from: [x, bottom],
      to: [x, top],
      extensions: [
        [
          [left - 0.5 * u, bottom],
          [x - 0.8 * u, bottom],
        ],
        [
          [left - 0.5 * u, top],
          [x - 0.8 * u, top],
        ],
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
