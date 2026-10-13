import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { PerspectiveCamera, Vector3 } from 'three'
import { usePoseRequest } from './poseRequest'

interface ControlsLike {
  target: Vector3
  update(): void
}

/**
 * Moves the camera to a pose asked for from outside the canvas, such as a reference photo's angle.
 * It never changes camera.up: OrbitControls assumes Z up, so the pose's `up` is ignored.
 */
export function PoseApplier() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const invalidate = useThree((s) => s.invalidate)
  const pose = usePoseRequest((s) => s.pose)
  const token = usePoseRequest((s) => s.token)
  // A viewer that mounts later (another tab, another project) must not replay an old request.
  const applied = useRef(token)
  useEffect(() => {
    if (!pose || !controls || token === applied.current) return
    applied.current = token
    camera.position.set(...pose.position)
    controls.target.set(...pose.target)
    controls.update()
    camera.updateMatrixWorld()
    invalidate()
  }, [pose, token, controls, camera, invalidate])
  return null
}
