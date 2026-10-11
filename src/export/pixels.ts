/** WebGL's readPixels returns rows bottom-up; ImageData wants them top-down. */
export function flipRows(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const row = width * 4
  const out = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y++) out.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row)
  return out
}
