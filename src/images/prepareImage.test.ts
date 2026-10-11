// @vitest-environment node
import { fitWithin, JPEG_QUALITY, MAX_IMAGE_EDGE, outputTypeFor, prepareImage, type ImageCodec } from './prepareImage'

describe('fitWithin', () => {
  it('scales the long edge down to 1568 px and keeps the aspect ratio', () => {
    expect(MAX_IMAGE_EDGE).toBe(1568)
    expect(fitWithin(8000, 6000)).toEqual({ width: 1568, height: 1176 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1176, height: 1568 })
  })

  it('never scales up, and never returns zero', () => {
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 })
    expect(fitWithin(10_000, 2)).toEqual({ width: 1568, height: 1 })
  })
})

it('keeps line art and transparency as PNG and sends photos as JPEG', () => {
  expect(outputTypeFor('image/png')).toBe('image/png')
  expect(outputTypeFor('image/webp')).toBe('image/png')
  expect(outputTypeFor('image/gif')).toBe('image/png')
  expect(outputTypeFor('image/jpeg')).toBe('image/jpeg')
  expect(outputTypeFor('image/heic')).toBe('image/jpeg')
})

describe('prepareImage', () => {
  function fakeCodec(width: number, height: number) {
    const close = vi.fn()
    const encode = vi.fn(async () => new Blob(['encoded'], { type: 'image/jpeg' }))
    const codec: ImageCodec = { decode: async () => ({ width, height, close }), encode }
    return { codec, encode, close }
  }

  it('re-encodes at the fitted size with the requested type and quality', async () => {
    const { codec, encode, close } = fakeCodec(8000, 6000)
    const result = await prepareImage(new Blob(['raw']), 'image/jpeg', codec)
    expect(encode).toHaveBeenCalledWith(expect.anything(), 1568, 1176, 'image/jpeg', JPEG_QUALITY)
    expect(result).toMatchObject({ mediaType: 'image/jpeg', width: 1568, height: 1176 })
    expect(close).toHaveBeenCalled()
  })

  it('passes decode failures through, so the caller can name the file', async () => {
    const codec: ImageCodec = { decode: () => Promise.reject(new Error('unsupported')), encode: vi.fn() }
    await expect(prepareImage(new Blob(['x']), 'image/png', codec)).rejects.toThrow('unsupported')
  })
})
