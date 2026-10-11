export const THUMBNAIL_SIZE = 96

/** Renders the current scene and returns the WebGL canvas; registered by the workbench viewer. */
export type ThumbnailSource = () => HTMLCanvasElement | null

let source: ThumbnailSource | null = null

export function setThumbnailSource(fn: ThumbnailSource | null): void {
  source = fn
}

export function squareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height)
  return { sx: (width - size) / 2, sy: (height - size) / 2, size }
}

export interface CaptureDeps {
  nextFrame?(): Promise<void>
  createCanvas?(size: number): HTMLCanvasElement
}

const twoFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

function newCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

/** 96 px PNG of the viewer's centre square, or null when no viewer is mounted. */
export async function captureThumbnail(deps: CaptureDeps = {}): Promise<Blob | null> {
  if (!source) return null
  await (deps.nextFrame ?? twoFrames)()
  const src = source?.()
  if (!src || src.width === 0 || src.height === 0) return null
  const canvas = (deps.createCanvas ?? newCanvas)(THUMBNAIL_SIZE)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Same task as the render above, so the WebGL drawing buffer still holds the frame.
  const { sx, sy, size } = squareCrop(src.width, src.height)
  ctx.drawImage(src, sx, sy, size, size, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}
