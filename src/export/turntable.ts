import type { MeshData } from '../render/types'
import { readToken } from '../theme/tokens'
import { formatMegabytes } from '../ui/bytes'
import { renderFrames, turntablePoses } from './frames'
import { createGifEncoder } from './gifClient'

export const MIN_TURNTABLE_FRAMES = 36
export const MAX_TURNTABLE_FRAMES = 72
const DEFAULT_TURNTABLE_FRAMES = 48

export function clampFrames(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TURNTABLE_FRAMES
  return Math.min(MAX_TURNTABLE_FRAMES, Math.max(MIN_TURNTABLE_FRAMES, Math.round(n)))
}

/** About 4 s per turn, rounded to the GIF's 10 ms resolution. */
export function turntableDelayMs(frames: number): number {
  return Math.max(20, Math.round(400 / frames) * 10)
}

export interface GifProgress {
  done: number
  total: number
  bytes: number
}

export function formatGifProgress({ done, total, bytes }: GifProgress): string {
  const estimate = done > 0 && bytes > 0 ? ` · about ${formatMegabytes((bytes / done) * total)} MB` : ''
  return `Rendering frames · ${done} of ${total}${estimate}`
}

export interface FrameDeps {
  renderFrames: typeof renderFrames
  createEncoder: typeof createGifEncoder
}

const defaultDeps: FrameDeps = { renderFrames, createEncoder: createGifEncoder }

export async function exportTurntable(
  opts: {
    mesh: MeshData
    size: [number, number]
    frames: number
    transparent: boolean
    signal: AbortSignal
    onProgress(p: GifProgress): void
    onFrame?(frame: ImageData): void
  },
  deps: FrameDeps = defaultDeps,
): Promise<Blob> {
  const total = clampFrames(opts.frames)
  const [width, height] = opts.size
  const delay = turntableDelayMs(total)
  const encoder = await deps.createEncoder(width, height, opts.transparent)
  try {
    let done = 0
    opts.onProgress({ done, total, bytes: 0 })
    const frames = deps.renderFrames({
      mesh: opts.mesh,
      size: opts.size,
      background: opts.transparent ? null : readToken('viewport'),
      cameras: turntablePoses(opts.mesh.bounds, total),
    })
    for await (const frame of frames) {
      opts.signal.throwIfAborted()
      opts.onFrame?.(frame)
      const bytes = await encoder.addFrame(frame, delay)
      done++
      opts.onProgress({ done, total, bytes })
    }
    opts.signal.throwIfAborted()
    return await encoder.finish()
  } finally {
    encoder.terminate()
  }
}
