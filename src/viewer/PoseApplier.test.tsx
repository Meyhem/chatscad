import { act, render } from '@testing-library/react'
import { PerspectiveCamera, Vector3 } from 'three'
import { usePoseRequest } from './poseRequest'
import { PoseApplier } from './PoseApplier'

const camera = new PerspectiveCamera()
const controls = { target: new Vector3(), update: vi.fn() }
const invalidate = vi.fn()

vi.mock('@react-three/fiber', () => ({
  useThree: (select: (s: unknown) => unknown) => select({ camera, controls, invalidate }),
}))

beforeEach(() => {
  camera.up.set(0, 0, 1)
  camera.position.set(1, 2, 3)
  usePoseRequest.setState({ pose: null, token: 0 })
  invalidate.mockClear()
})

it('moves the camera to a requested pose and never touches the up vector', () => {
  render(<PoseApplier />)
  act(() => usePoseRequest.getState().request({ position: [5, -6, 7], target: [1, 1, 1], up: [0, 1, 0] }))
  expect(camera.position.toArray()).toEqual([5, -6, 7])
  expect(controls.target.toArray()).toEqual([1, 1, 1])
  expect(camera.up.toArray()).toEqual([0, 0, 1])
  expect(invalidate).toHaveBeenCalled()
})

it('does not replay a request made before it mounted', () => {
  usePoseRequest.getState().request({ position: [5, -6, 7], target: [1, 1, 1] })
  render(<PoseApplier />)
  expect(camera.position.toArray()).toEqual([1, 2, 3])
})
