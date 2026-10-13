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

export function referencePose(bounds: Bounds, view: ReferenceView, aspect = 1): CameraPose {
  if (view === 'back') {
    const front = presetPose(bounds, 'front', aspect)
    const [px, py, pz] = front.position
    const [, ty] = front.target
    return { ...front, position: [px, 2 * ty - py, pz] }
  }
  if (view === 'bottom') {
    const top = presetPose(bounds, 'top', aspect)
    const [px, py, pz] = top.position
    const [, , tz] = top.target
    return { ...top, position: [px, py, 2 * tz - pz], up: [0, 1, 0] }
  }
  return presetPose(bounds, view, aspect)
}
