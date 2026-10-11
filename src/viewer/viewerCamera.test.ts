import { PerspectiveCamera, Vector3 } from 'three'
import { getViewerPose, poseFromCamera, setViewerPose } from './viewerCamera'

it('remembers the last pose the main viewer reported', () => {
  expect(getViewerPose()).toBeNull()
  setViewerPose({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] })
  expect(getViewerPose()).toEqual({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] })
  setViewerPose(null)
  expect(getViewerPose()).toBeNull()
})

it('records the fov and the canvas aspect with the pose', () => {
  const camera = new PerspectiveCamera(45, 2, 0.1, 1000)
  camera.position.set(1, 2, 3)
  camera.up.set(0, 0, 1)
  expect(poseFromCamera(camera, new Vector3(4, 5, 6), { width: 800, height: 400 })).toEqual({
    position: [1, 2, 3],
    target: [4, 5, 6],
    up: [0, 0, 1],
    fov: 45,
    aspect: 2,
  })
})

it('reports no pose while the canvas is hidden, so the last framed one is kept', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 1000)
  expect(poseFromCamera(camera, new Vector3(), { width: 800, height: 0 })).toBeNull()
})
