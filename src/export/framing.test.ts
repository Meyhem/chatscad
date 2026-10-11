import { PerspectiveCamera, Vector3 } from 'three'
import type { Bounds } from '../render/types'
import { fitPoseToAspect, FRAME_FOV, presetPose, turntablePoses, type CameraPose } from './frames'

const BOUNDS: Bounds = { min: [0, 0, 0], max: [88.8, 25.4, 22] }

function corners(b: Bounds): Vector3[] {
  const out: Vector3[] = []
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push(new Vector3(x, y, z))
  return out
}

/** Whether every corner of `b` projects inside the image drawn from `pose` at `aspect`. */
function inFrame(pose: CameraPose, aspect: number, b: Bounds): boolean {
  const cam = new PerspectiveCamera(pose.fov ?? FRAME_FOV, aspect, 0.1, 10_000)
  cam.up.set(...(pose.up ?? [0, 0, 1]))
  cam.position.set(...pose.position)
  cam.lookAt(...pose.target)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  return corners(b).every((c) => {
    const p = c.clone().project(cam)
    return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1
  })
}

describe.each([
  ['1080 × 1080', 1],
  ['1920 × 1080', 1920 / 1080],
  ['800 × 600', 800 / 600],
  ['a tall 600 × 1080', 600 / 1080],
])('at %s', (_label, aspect) => {
  it.each(['iso', 'front', 'top'] as const)('the %s preset keeps the whole model in frame', (preset) => {
    expect(inFrame(presetPose(BOUNDS, preset, aspect), aspect, BOUNDS)).toBe(true)
  })

  it('every turntable frame keeps the whole model in frame', () => {
    expect(turntablePoses(BOUNDS, 12, aspect).every((pose) => inFrame(pose, aspect, BOUNDS))).toBe(true)
  })
})

it('keeps what a wide viewer showed when the image is square', () => {
  // The person zoomed in as far as the wide canvas still shows the whole model.
  const fit = presetPose(BOUNDS, 'iso', 2.4)
  const zoomed = (zoom: number): CameraPose => ({
    ...fit,
    position: fit.position.map((p, i) => fit.target[i] + (p - fit.target[i]) * zoom) as CameraPose['position'],
    aspect: 2.4,
  })
  let zoom = 1
  while (inFrame(zoomed(zoom - 0.02), 2.4, BOUNDS)) zoom -= 0.02
  const viewer = zoomed(zoom)
  expect(zoom).toBeLessThan(1)
  expect(inFrame(viewer, 1, BOUNDS)).toBe(false)
  expect(inFrame(fitPoseToAspect(viewer, 1), 1, BOUNDS)).toBe(true)
})

it('keeps the vertical fov when the image is wider than the viewer', () => {
  const viewer = { ...presetPose(BOUNDS, 'iso', 1), aspect: 1 }
  expect(fitPoseToAspect(viewer, 16 / 9).fov).toBe(FRAME_FOV)
})

it('leaves a pose without an aspect at the default fov', () => {
  const pose = presetPose(BOUNDS, 'iso', 1)
  expect(fitPoseToAspect(pose, 1)).toEqual({ ...pose, fov: FRAME_FOV })
})
