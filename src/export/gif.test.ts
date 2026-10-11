import { GifBuilder } from './gif'

function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) out.set(rgba, i * 4)
  return out
}

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes)

/** Graphic Control Extensions: 0x21 0xF9 0x04 packed delayLo delayHi transparentIndex 0x00. */
function graphicControls(b: Uint8Array) {
  const out: Array<{ packed: number; delay: number; transparentIndex: number }> = []
  for (let i = 0; i + 7 < b.length; i++) {
    if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) {
      out.push({ packed: b[i + 3], delay: b[i + 4] | (b[i + 5] << 8), transparentIndex: b[i + 6] })
    }
  }
  return out
}

it('writes a looping GIF89a of the frame size', () => {
  const gif = new GifBuilder(4, 3, false)
  gif.addFrame(solid(4, 3, [233, 162, 59, 255]), 100)
  const bytes = gif.finish()
  expect(text(bytes.subarray(0, 6))).toBe('GIF89a')
  expect(bytes[6] | (bytes[7] << 8)).toBe(4)
  expect(bytes[8] | (bytes[9] << 8)).toBe(3)
  expect(text(bytes)).toContain('NETSCAPE2.0')
  expect(bytes[bytes.length - 1]).toBe(0x3b)
})

it('stores each frame delay in hundredths of a second', () => {
  const gif = new GifBuilder(2, 2, false)
  gif.addFrame(solid(2, 2, [0, 0, 0, 255]), 800)
  gif.addFrame(solid(2, 2, [255, 255, 255, 255]), 2800)
  expect(graphicControls(gif.finish()).map((g) => g.delay)).toEqual([80, 280])
})

it('marks the cleared ground transparent when asked', () => {
  const frame = solid(2, 2, [233, 162, 59, 255])
  frame.set([0, 0, 0, 0], 0)
  frame.set([0, 0, 0, 0], 4)
  const gif = new GifBuilder(2, 2, true)
  gif.addFrame(frame, 100)
  const [gce] = graphicControls(gif.finish())
  expect(gce.packed & 1).toBe(1)
})

it('keeps opaque frames opaque', () => {
  const gif = new GifBuilder(2, 2, false)
  gif.addFrame(solid(2, 2, [10, 20, 30, 255]), 100)
  expect(graphicControls(gif.finish())[0].packed & 1).toBe(0)
})

it('reports the encoded size so far', () => {
  const gif = new GifBuilder(8, 8, false)
  const first = gif.addFrame(solid(8, 8, [1, 2, 3, 255]), 100)
  const second = gif.addFrame(solid(8, 8, [200, 100, 50, 255]), 100)
  expect(first).toBeGreaterThan(0)
  expect(second).toBeGreaterThan(first)
})

it('rejects a frame of the wrong size and an empty GIF', () => {
  expect(() => new GifBuilder(4, 3, false).addFrame(solid(2, 2, [0, 0, 0, 255]), 100)).toThrow(
    'Frame has 4 pixels, expected 4 × 3',
  )
  expect(() => new GifBuilder(4, 3, false).finish()).toThrow('Add at least one frame before finishing the GIF')
})
