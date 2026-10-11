// @vitest-environment node
import { crc32, inflateSync } from 'node:zlib'
import { ICONS, primaryColor, readTokens } from '../build/pwa'
import { encodePng, hexToRgb, ICON_FILES, renderIcon, type Rgb } from './gen-icons'

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

const bg: Rgb = [13, 16, 21]
const fg: Rgb = [233, 162, 59]
const pixel = (rgba: Uint8Array, size: number, x: number, y: number) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)]

it('encodes a valid 8-bit RGBA PNG', () => {
  const png = decodePng(encodePng(4, 2, renderIcon({ size: 4, square: 0.5, background: bg, foreground: fg }).subarray(0, 32)))
  expect(png).toMatchObject({ width: 4, height: 2, types: ['IHDR', 'IDAT', 'IEND'] })
})

it('draws the filament square centred on the ground colour', () => {
  const size = 64
  const { rgba } = decodePng(encodePng(size, size, renderIcon({ size, square: 0.5, background: bg, foreground: fg })))
  expect(pixel(rgba, size, 32, 32)).toEqual([...fg, 255])
  expect(pixel(rgba, size, 2, 2)).toEqual([...bg, 255])
  expect(pixel(rgba, size, 18, 32)).toEqual([...fg, 255])
  expect(pixel(rgba, size, 14, 32)).toEqual([...bg, 255])
})

it('keeps the maskable square inside the 80 % safe circle', () => {
  const size = 100
  const rgba = renderIcon({ size, square: 0.4, background: bg, foreground: fg })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(rgba, size, x, y)
      if (r !== bg[0] || g !== bg[1] || b !== bg[2]) expect(Math.hypot(x + 0.5 - 50, y + 0.5 - 50)).toBeLessThanOrEqual(40)
    }
  }
})

it('reads #rrggbb colours only, and the tokens are such colours', () => {
  expect(hexToRgb('#e9a23b')).toEqual([233, 162, 59])
  expect(() => hexToRgb('rgb(1, 2, 3)')).toThrow('Expected a #rrggbb colour, got rgb(1, 2, 3)')
  const tokens = readTokens()
  expect(() => hexToRgb(primaryColor(tokens, 'bg'))).not.toThrow()
  expect(() => hexToRgb(primaryColor(tokens, 'filament'))).not.toThrow()
})

it('writes the files the manifest names', () => {
  expect(ICON_FILES.map((f) => `icons/${f.file}`)).toEqual(ICONS.map((i) => i.src))
})
