import type { Bounds, MeshData, Vec3 } from '../render/types'
import { readToken } from '../theme/tokens'
import { computeCameraFit } from '../viewer/cameraFit'
import { createGlFrameRenderer } from './glFrameRenderer'

export interface CameraPose {
  position: Vec3
  target: Vec3
  up?: Vec3
  /** Vertical field of view in degrees used to draw this pose; FRAME_FOV when absent. */
  fov?: number
  /** Width / height of the view that framed this pose (the main viewer's canvas). */
  aspect?: number
  /** Draw with an orthographic camera showing 2 × halfHeight mm vertically; `fov` is ignored. */
  ortho?: { halfHeight: number }
}

/** Field of view of every exported frame; the main viewer uses the same. */
export const FRAME_FOV = 45

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** Widens the vertical fov when the image is narrower than the view that framed `pose`, so its sides are never cropped. */
export function fitPoseToAspect(pose: CameraPose, aspect: number): CameraPose {
  const vFov = pose.fov ?? FRAME_FOV
  if (!pose.aspect || aspect >= pose.aspect) return { ...pose, fov: vFov }
  const halfWidth = Math.tan(toRad(vFov) / 2) * pose.aspect
  return { ...pose, fov: toDeg(2 * Math.atan(halfWidth / aspect)) }
}

/** A preset camera that fits the whole model into an image of `aspect` (width / height). */
export type PresetView = 'iso' | 'front' | 'top' | 'right'

export function presetPose(bounds: Bounds, preset: PresetView, aspect = 1): CameraPose {
  const fit = computeCameraFit(bounds, FRAME_FOV, aspect)
  const [tx, ty, tz] = fit.target
  switch (preset) {
    case 'iso':
      return { position: fit.position, target: fit.target }
    case 'front':
      return { position: [tx, ty - fit.distance, tz], target: fit.target }
    case 'top':
      // Looking straight down Z, so Z cannot be "up"; Y points up the image.
      return { position: [tx, ty, tz + fit.distance], target: fit.target, up: [0, 1, 0] }
    case 'right':
      return { position: [tx + fit.distance, ty, tz], target: fit.target }
  }
}

export type OrthoView = Exclude<PresetView, 'iso'>

/** An orthographic camera on an axis through the centre of `bounds`, showing 2 × `halfHeight` mm vertically. */
export function orthoPose(bounds: Bounds, view: OrthoView, halfHeight: number): CameraPose {
  const { min, max } = bounds
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  // Far enough to stay outside the model; with no perspective the distance changes nothing else.
  const d = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]), 1) * 2
  const [tx, ty, tz] = target
  const ortho = { halfHeight }
  switch (view) {
    case 'front':
      return { position: [tx, ty - d, tz], target, ortho }
    case 'top':
      return { position: [tx, ty, tz + d], target, up: [0, 1, 0], ortho }
    case 'right':
      return { position: [tx + d, ty, tz], target, ortho }
  }
}

/** One full turn about the Z axis, starting at the iso pose. */
export function turntablePoses(bounds: Bounds, frames: number, aspect = 1): CameraPose[] {
  const { position, target } = presetPose(bounds, 'iso', aspect)
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
  /** Per-vertex colours (part colours); the filament token otherwise. */
  colours?: Float32Array
}): AsyncGenerator<ImageData> {
  const [width, height] = opts.size
  const renderer = createGlFrameRenderer({ width, height, background: opts.background, filament: readToken('filament') })
  try {
    if (opts.colours) renderer.setMesh(opts.mesh, opts.colours)
    else renderer.setMesh(opts.mesh)
    for (const pose of opts.cameras) {
      yield renderer.render(pose)
      // Let the page paint and take input between frames.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    renderer.dispose()
  }
}
