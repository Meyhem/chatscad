import type { Bounds, Vec3 } from '../render/types'

export interface CameraFit {
  position: Vec3
  target: Vec3
  distance: number
}

const MIN_RADIUS = 1
const VIEW_DIR: Vec3 = (() => {
  const d: Vec3 = [1, -1.2, 0.9]
  const len = Math.hypot(...d)
  return [d[0] / len, d[1] / len, d[2] / len]
})()

export function computeCameraFit(bounds: Bounds, fovDeg: number, aspect: number, margin = 1.2): CameraFit {
  const { min, max } = bounds
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, MIN_RADIUS)
  const vFov = (fovDeg * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  const distance = (radius * margin) / Math.sin(Math.min(vFov, hFov) / 2)
  const position: Vec3 = [
    target[0] + VIEW_DIR[0] * distance,
    target[1] + VIEW_DIR[1] * distance,
    target[2] + VIEW_DIR[2] * distance,
  ]
  return { position, target, distance }
}
