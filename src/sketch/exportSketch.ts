import { useAttachments } from '../images/attachments'
import { readToken } from '../theme/tokens'
import { drawSketch, SKETCH_SIZE, type SketchColors, type SketchItem, type SketchResult } from './sketchModel'

export function sketchColors(): SketchColors {
  return { ground: readToken('inset'), grid: readToken('grid-minor'), ink: readToken('ink'), accent: readToken('accent') }
}

export function exportSketchPng(items: readonly SketchItem[], colors: SketchColors = sketchColors()): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SKETCH_SIZE.width
  canvas.height = SKETCH_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D is not available'))
  drawSketch(ctx, items, colors)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the sketch'))), 'image/png'),
  )
}

/** Sketches go out as PNG (sharp lines), already within the 1568 px limit. */
export async function attachSketch({ items, note }: SketchResult): Promise<void> {
  try {
    const blob = await exportSketchPng(items)
    useAttachments
      .getState()
      .addPrepared({ blob, mediaType: 'image/png', width: SKETCH_SIZE.width, height: SKETCH_SIZE.height }, 'Sketch', note)
  } catch {
    useAttachments.getState().setError('Could not save the sketch. Try again, or attach a photo of a drawing instead.')
  }
}
