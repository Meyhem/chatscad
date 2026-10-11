import type { Bounds, MeshData, Vec3 } from '../render/types'
import { readToken } from '../theme/tokens'
import { computeCameraFit } from '../viewer/cameraFit'
import { createGlFrameRenderer } from './glFrameRenderer'

export interface CameraPose {
  position: Vec3
  target: Vec3
  up?: Vec3
}

/** Field of view of every exported frame; the main viewer uses the same. */
export const FRAME_FOV = 45

export function presetPose(bounds: Bounds, preset: 'iso' | 'front' | 'top'): CameraPose {
  const fit = computeCameraFit(bounds, FRAME_FOV, 1)
  const [tx, ty, tz] = fit.target
  switch (preset) {
    case 'iso':
      return { position: fit.position, target: fit.target }
    case 'front':
      return { position: [tx, ty - fit.distance, tz], target: fit.target }
    case 'top':
      // Looking straight down Z, so Z cannot be "up"; Y points up the image.
      return { position: [tx, ty, tz + fit.distance], target: fit.target, up: [0, 1, 0] }
  }
}

/** One full turn about the Z axis, starting at the iso pose. */
export function turntablePoses(bounds: Bounds, frames: number): CameraPose[] {
  const { position, target } = presetPose(bounds, 'iso')
  const dx = position[0] - target[0]
  const dy = position[1] - target[1]
  return Array.from({ length: frames }, (_, i) => {
    const a = (2 * Math.PI * i) / frames
    const c = Math.cos(a)
    const s = Math.sin(a)
    const p: Vec3 = [target[0] + dx * c - dy * s, target[1] + dx * s + dy * c, position[2]]
    return { position: p, target }
  })
}

/** Draws `mesh` once per camera pose, offscreen. `background: null` gives a transparent ground. */
export async function* renderFrames(opts: {
  mesh: MeshData
  size: [number, number]
  background: string | null
  cameras: CameraPose[]
}): AsyncGenerator<ImageData> {
  const [width, height] = opts.size
  const renderer = createGlFrameRenderer({ width, height, background: opts.background, filament: readToken('filament') })
  try {
    renderer.setMesh(opts.mesh)
    for (const pose of opts.cameras) {
      yield renderer.render(pose)
      // Let the page paint and take input between frames.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    renderer.dispose()
  }
}
