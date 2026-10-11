import type { CameraPose } from '../export/frames'

let current: CameraPose | null = null

/** The main viewer's orbit pose, for "Current view" exports. Not React state: only read on demand. */
export function setViewerPose(pose: CameraPose | null): void {
  current = pose
}

export function getViewerPose(): CameraPose | null {
  return current
}
