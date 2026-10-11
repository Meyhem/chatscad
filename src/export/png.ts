/** Encodes a frame as PNG with the browser's own encoder. */
export async function imageDataToPng(image: ImageData): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('The browser has no 2D canvas to encode the PNG')
    ctx.putImageData(image, 0, 0)
    return canvas.convertToBlob({ type: 'image/png' })
  }
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser has no 2D canvas to encode the PNG')
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the PNG'))), 'image/png'),
  )
}
