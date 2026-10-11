import { getViewerPose, setViewerPose } from './viewerCamera'

it('remembers the last pose the main viewer reported', () => {
  expect(getViewerPose()).toBeNull()
  setViewerPose({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] })
  expect(getViewerPose()).toEqual({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] })
  setViewerPose(null)
  expect(getViewerPose()).toBeNull()
})
