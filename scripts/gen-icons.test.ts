// @vitest-environment node
import { crc32, inflateSync } from 'node:zlib'
import { FAVICON, ICONS, primaryColor, readTokens } from '../build/pwa'
import { cubeShades, encodePng, glyph, hexToRgb, ICON_FILES, ICON_SVG, iconSvg, renderIcon, rgbToHex, type Palette, type Rgb } from './gen-icons'

function decodePng(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  const types: string[] = []
  const idat: Uint8Array[] = []
  while (offset < png.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
    const data = png.subarray(offset + 8, offset + 8 + length)
    expect(view.getUint32(offset + 8 + length)).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)))
    types.push(type)
    if (type === 'IHDR') {
      const ihdr = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = ihdr.getUint32(0)
      height = ihdr.getUint32(4)
      expect([data[8], data[9]]).toEqual([8, 6])
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = 1 + width * 4
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0)
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4)
  }
  return { width, height, rgba, types }
}

const palette: Palette = { background: [13, 16, 21], accent: [110, 155, 255], filament: [233, 162, 59] }
const bg = palette.background
const pixel = (rgba: Uint8Array, size: number, x: number, y: number) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)]
const shapes = glyph(palette)
const shades = cubeShades(palette.filament)
const lum = ([r, g, b]: Rgb) => r + g + b

it('encodes a valid 8-bit RGBA PNG', () => {
  const png = decodePng(encodePng(4, 2, renderIcon({ size: 4, scale: 1, background: bg, shapes }).subarray(0, 32)))
  expect(png).toMatchObject({ width: 4, height: 2, types: ['IHDR', 'IDAT', 'IEND'] })
})

it('shades the cube from the filament colour: lit top, plain left, shadowed right', () => {
  expect(shades.left).toEqual(palette.filament)
  expect(lum(shades.top)).toBeGreaterThan(lum(palette.filament))
  expect(lum(shades.right)).toBeLessThan(lum(palette.filament))
})

it('draws accent braces around a filament cube on the ground colour', () => {
  const size = 64
  const { rgba } = decodePng(encodePng(size, size, renderIcon({ size, scale: 1, background: bg, shapes })))
  expect(pixel(rgba, size, 1, 1)).toEqual([...bg, 255])
  // Brace tips at x = 4 and 28 of the 32-unit grid, mid-height.
  expect(pixel(rgba, size, 8, 32)).toEqual([...palette.accent, 255])
  expect(pixel(rgba, size, 55, 32)).toEqual([...palette.accent, 255])
  // Cube faces: top above the centre, left and right below it.
  expect(pixel(rgba, size, 32, 26)).toEqual([...shades.top, 255])
  expect(pixel(rgba, size, 27, 37)).toEqual([...shades.left, 255])
  expect(pixel(rgba, size, 36, 37)).toEqual([...shades.right, 255])
  // Gap between brace and cube shows the ground.
  expect(pixel(rgba, size, 18, 32)).toEqual([...bg, 255])
})

it('keeps the maskable glyph inside the 80 % safe circle', () => {
  const size = 100
  const scale = ICON_FILES.find((f) => f.file === 'icon-maskable-512.png')!.scale
  const rgba = renderIcon({ size, scale, background: bg, shapes })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(rgba, size, x, y)
      if (r !== bg[0] || g !== bg[1] || b !== bg[2]) expect(Math.hypot(x + 0.5 - 50, y + 0.5 - 50)).toBeLessThanOrEqual(40)
    }
  }
})

it('writes the same glyph as a self-contained SVG favicon on a rounded tile', () => {
  const svg = iconSvg(palette)
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/)
  expect(svg).toContain('<rect width="32" height="32" rx="7" fill="#0d1015"/>')
  expect(svg).toContain('stroke="#6e9bff"')
  for (const c of Object.values(shades)) expect(svg).toContain(`fill="${rgbToHex(c)}"`)
  expect(svg.match(/<polygon /g)).toHaveLength(3)
  expect(svg.match(/<polyline /g)).toHaveLength(2)
  expect(svg).not.toMatch(/href|<script|url\(/)
})

it('reads #rrggbb colours only, and the tokens are such colours', () => {
  expect(hexToRgb('#e9a23b')).toEqual([233, 162, 59])
  expect(() => hexToRgb('rgb(1, 2, 3)')).toThrow('Expected a #rrggbb colour, got rgb(1, 2, 3)')
  const tokens = readTokens()
  expect(() => hexToRgb(primaryColor(tokens, 'bg'))).not.toThrow()
  expect(() => hexToRgb(primaryColor(tokens, 'filament'))).not.toThrow()
  expect(() => hexToRgb(primaryColor(tokens, 'accent'))).not.toThrow()
  expect(rgbToHex([13, 16, 21])).toBe('#0d1015')
})

it('writes the files the manifest names', () => {
  expect(ICON_FILES.map((f) => `icons/${f.file}`)).toEqual(ICONS.map((i) => i.src))
  expect(`icons/${ICON_SVG}`).toBe(FAVICON)
})
