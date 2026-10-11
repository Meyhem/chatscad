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

export interface IconSpec {
  size: number
  /** Side of the square as a fraction of the icon. */
  square: number
  background: Rgb
  foreground: Rgb
}

/** The wordmark's filament square (corner radius a quarter of its side) centred on the ground, 4 × 4 supersampled. */
export function renderIcon({ size, square, background, foreground }: IconSpec): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  const side = size * square
  const radius = side * 0.25
  const lo = (size - side) / 2
  const hi = lo + side
  const inside = (x: number, y: number) => {
    if (x < lo || x > hi || y < lo || y > hi) return false
    const cx = Math.min(Math.max(x, lo + radius), hi - radius)
    const cy = Math.min(Math.max(y, lo + radius), hi - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
  }
  const samples = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) if (inside(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples)) hits++
      }
      const a = hits / (samples * samples)
      const i = (y * size + x) * 4
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(background[c] * (1 - a) + foreground[c] * a)
      out[i + 3] = 255
    }
  }
  return out
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
  { file: 'icon-192.png', size: 192, square: 0.5 },
  { file: 'icon-512.png', size: 512, square: 0.5 },
  { file: 'icon-maskable-512.png', size: 512, square: 0.4 },
] as const

const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url))

async function main(): Promise<void> {
  const tokens = readTokens()
  const background = hexToRgb(primaryColor(tokens, 'bg'))
  const foreground = hexToRgb(primaryColor(tokens, 'filament'))
  await mkdir(OUT_DIR, { recursive: true })
  for (const { file, size, square } of ICON_FILES) {
    await writeFile(OUT_DIR + file, encodePng(size, size, renderIcon({ size, square, background, foreground })))
  }
  console.log(`Wrote ${ICON_FILES.length} icons to ${OUT_DIR}`)
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
