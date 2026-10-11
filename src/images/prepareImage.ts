export const MAX_IMAGE_EDGE = 1568
export const JPEG_QUALITY = 0.85

export type OutputType = 'image/png' | 'image/jpeg'

export interface PreparedImage {
  blob: Blob
  mediaType: OutputType
  width: number
  height: number
}

export interface DecodedImage {
  width: number
  height: number
  close?(): void
}

export interface ImageCodec {
  decode(blob: Blob): Promise<DecodedImage>
  encode(image: DecodedImage, width: number, height: number, type: OutputType, quality: number): Promise<Blob>
}

export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const LOSSLESS = new Set(['image/png', 'image/webp', 'image/gif', 'image/svg+xml'])

export function outputTypeFor(inputType: string): OutputType {
  return LOSSLESS.has(inputType) ? 'image/png' : 'image/jpeg'
}

export const browserCodec: ImageCodec = {
  decode: (blob) => createImageBitmap(blob),
  encode(image, width, height, type, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.reject(new Error('Canvas 2D is not available'))
    ctx.drawImage(image as ImageBitmap, 0, 0, width, height)
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), type, quality),
    )
  },
}

/** Downscales to at most 1568 px on the long edge and re-encodes (which also drops EXIF data such as location). */
export async function prepareImage(blob: Blob, type: OutputType, codec: ImageCodec = browserCodec): Promise<PreparedImage> {
  const image = await codec.decode(blob)
  try {
    const { width, height } = fitWithin(image.width, image.height)
    return { blob: await codec.encode(image, width, height, type, JPEG_QUALITY), mediaType: type, width, height }
  } finally {
    image.close?.()
  }
}
