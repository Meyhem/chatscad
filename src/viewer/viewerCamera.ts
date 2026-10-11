import type { PerspectiveCamera, Vector3 } from 'three'
import type { CameraPose } from '../export/frames'

let current: CameraPose | null = null

/** The main viewer's orbit pose, for "Current view" exports. Not React state: only read on demand. */
export function setViewerPose(pose: CameraPose | null): void {
  current = pose
}

export function getViewerPose(): CameraPose | null {
  return current
}

/** The pose plus the fov and canvas aspect it was framed with, so an export of another shape can keep all of it in view. */
export function poseFromCamera(camera: PerspectiveCamera, target: Vector3, size: { width: number; height: number }): CameraPose {
  return {
    position: camera.position.toArray(),
    target: target.toArray(),
    up: camera.up.toArray(),
    fov: camera.fov,
    ...(size.height > 0 ? { aspect: size.width / size.height } : {}),
  }
}
