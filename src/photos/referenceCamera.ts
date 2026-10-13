import { presetPose, type CameraPose } from '../export/frames'
import type { Bounds } from '../render/types'
import type { PhotoAngle } from './projectPhotos'

export type ReferenceView = 'front' | 'top' | 'right' | 'back' | 'bottom'

/** The camera that matches a photo's angle; null for an untagged photo (spec P12). */
export function referenceView(angle: PhotoAngle): ReferenceView | null {
  switch (angle) {
    case 'front':
    case 'top':
    case 'back':
    case 'bottom':
      return angle
    case 'side':
      return 'right'
    default:
      return null
  }
}

/** How far off the Z axis top and bottom sit, as a fraction of the fit distance, so lookAt stays defined with Z up. */
const POLE_OFFSET = 1e-3

/**
 * The live viewer keeps camera.up at +Z because OrbitControls assumes it, so top and bottom never set `up`.
 * They sit a hair toward -Y instead: looking down, +Y points up the screen.
 */
export function referencePose(bounds: Bounds, view: ReferenceView, aspect = 1): CameraPose {
  if (view === 'back') {
    const front = presetPose(bounds, 'front', aspect)
    const [px, py, pz] = front.position
    const [, ty] = front.target
    return { ...front, position: [px, 2 * ty - py, pz] }
  }
  if (view === 'top' || view === 'bottom') {
    const top = presetPose(bounds, 'top', aspect)
    const [tx, ty, tz] = top.target
    const distance = top.position[2] - tz
    const dz = view === 'top' ? distance : -distance
    return { position: [tx, ty - distance * POLE_OFFSET, tz + dz], target: top.target }
  }
  return presetPose(bounds, view, aspect)
}
