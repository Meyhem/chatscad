import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { primaryColor, readTokens } from '../build/pwa'

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Expected a #rrggbb colour, got ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(rgb: Rgb): string {
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('')
}

/** Linear blend from `a` (t = 0) to `b` (t = 1). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t)) as Rgb
}

export interface Palette {
  background: Rgb
  accent: Rgb
  filament: Rgb
}

type Point = [number, number]

export type Shape =
  | { kind: 'polygon'; points: Point[]; colour: Rgb }
  | { kind: 'stroke'; points: Point[]; width: number; colour: Rgb }

/** The glyph is drawn on a 32 × 32 grid, the favicon's own size. */
export const GRID = 32

export function cubeShades(filament: Rgb): { top: Rgb; left: Rgb; right: Rgb } {
  return { top: mix(filament, [255, 255, 255], 0.4), left: filament, right: mix(filament, [0, 0, 0], 0.22) }
}

function quad(from: Point, control: Point, to: Point, steps = 8): Point[] {
  const out: Point[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push([u * u * from[0] + 2 * u * t * control[0] + t * t * to[0], u * u * from[1] + 2 * u * t * control[1] + t * t * to[1]])
  }
  return out
}

/** Left curly brace, flattened: two quarter-round corners, the mid-height point, and the straight runs between them. */
const LEFT_BRACE: Point[] = [
  [10, 5.5],
  ...quad([10, 5.5], [7, 5.5], [7, 8.5]),
  [7, 13],
  ...quad([7, 13], [7, 16], [4, 16]),
  ...quad([4, 16], [7, 16], [7, 19]),
  [7, 23.5],
  ...quad([7, 23.5], [7, 26.5], [10, 26.5]),
]

/** Braces around an isometric cube: code that makes a solid. */
export function glyph({ accent, filament }: Palette): Shape[] {
  const { top, left, right } = cubeShades(filament)
  const [cx, cy, s] = [16, 16, 5.5]
  const h = s * 0.58
  const n: Point = [cx, cy - s]
  const w: Point = [cx - s, cy - s + h]
  const e: Point = [cx + s, cy - s + h]
  const mid: Point = [cx, cy - s + 2 * h]
  const sw: Point = [cx - s, cy + s - h]
  const se: Point = [cx + s, cy + s - h]
  const south: Point = [cx, cy + s]
  return [
    { kind: 'stroke', points: LEFT_BRACE, width: 2.4, colour: accent },
    { kind: 'stroke', points: LEFT_BRACE.map(([x, y]) => [GRID - x, y]), width: 2.4, colour: accent },
    { kind: 'polygon', points: [n, e, mid, w], colour: top },
    { kind: 'polygon', points: [w, mid, south, sw], colour: left },
    { kind: 'polygon', points: [mid, e, se, south], colour: right },
  ]
}

function insidePolygon(points: Point[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Round caps and joins: within half the width of any segment. */
function onStroke(points: Point[], halfWidth: number, x: number, y: number): boolean {
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= halfWidth * halfWidth) return true
  }
  return false
}

export interface IconSpec {
  size: number
  /** Glyph scale about the centre; 1 fills the icon as the 32-unit grid fills the favicon. */
  scale: number
  background: Rgb
  shapes: Shape[]
}

/** The glyph full-bleed on the ground colour, later shapes painted over earlier ones, 4 × 4 supersampled. */
export function renderIcon({ size, scale, background, shapes }: IconSpec): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  const unit = (size / GRID) * scale
  const offset = (size - GRID * unit) / 2
  const hits = shapes.map((shape) => {
    const pad = shape.kind === 'stroke' ? shape.width / 2 : 0
    const xs = shape.points.map((p) => p[0])
    const ys = shape.points.map((p) => p[1])
    const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
    return (x: number, y: number) =>
      x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] &&
      (shape.kind === 'stroke' ? onStroke(shape.points, pad, x, y) : insidePolygon(shape.points, x, y))
  })
  const samples = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const gx = (x + (sx + 0.5) / samples - offset) / unit
          const gy = (y + (sy + 0.5) / samples - offset) / unit
          let colour = background
          for (let k = shapes.length - 1; k >= 0; k--) {
            if (hits[k](gx, gy)) {
              colour = shapes[k].colour
              break
            }
          }
          for (let c = 0; c < 3; c++) sum[c] += colour[c]
        }
      }
      const i = (y * size + x) * 4
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(sum[c] / (samples * samples))
      out[i + 3] = 255
    }
  }
  return out
}

/** The same shapes as the PNGs, on a rounded tile so the favicon reads on light and dark tab strips. */
export function iconSvg(palette: Palette): string {
  const pts = (points: Point[]) => points.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(' ')
  const body = glyph(palette).map((shape) =>
    shape.kind === 'stroke'
      ? `<polyline points="${pts(shape.points)}" fill="none" stroke="${rgbToHex(shape.colour)}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<polygon points="${pts(shape.points)}" fill="${rgbToHex(shape.colour)}"/>`,
  )
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">`,
    `<rect width="${GRID}" height="${GRID}" rx="7" fill="${rgbToHex(palette.background)}"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n')
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, width)
  header.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = 1 + width * 4
  const raw = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1) // filter 0
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export const ICON_FILES = [
  { file: 'icon-192.png', size: 192, scale: 0.86 },
  { file: 'icon-512.png', size: 512, scale: 0.86 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.66 },
] as const

export const ICON_SVG = 'icon.svg'

/** Safari ignores SVG favicons. Full-bleed at the favicon's own grid, so not in the manifest. */
export const FAVICON_PNG_FILE = { file: 'icon-32.png', size: 32, scale: 1 } as const

const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url))

async function main(): Promise<void> {
  const tokens = readTokens()
  const palette: Palette = {
    background: hexToRgb(primaryColor(tokens, 'bg')),
    accent: hexToRgb(primaryColor(tokens, 'accent')),
    filament: hexToRgb(primaryColor(tokens, 'filament')),
  }
  const shapes = glyph(palette)
  await mkdir(OUT_DIR, { recursive: true })
  for (const { file, size, scale } of [...ICON_FILES, FAVICON_PNG_FILE]) {
    await writeFile(OUT_DIR + file, encodePng(size, size, renderIcon({ size, scale, background: palette.background, shapes })))
  }
  await writeFile(OUT_DIR + ICON_SVG, iconSvg(palette))
  console.log(`Wrote ${ICON_FILES.length + 2} icons to ${OUT_DIR}`)
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
