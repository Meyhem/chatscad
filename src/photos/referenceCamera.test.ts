import { presetPose } from '../export/frames'
import { referencePose, referenceView } from './referenceCamera'

const bounds = { min: [0, 0, 0] as [number, number, number], max: [10, 20, 30] as [number, number, number] }

it('maps photo angles to camera views', () => {
  expect(referenceView('front')).toBe('front')
  expect(referenceView('side')).toBe('right')
  expect(referenceView('bottom')).toBe('bottom')
  expect(referenceView('other')).toBeNull()
  expect(referenceView('photo')).toBeNull()
})

it('reuses the export presets and mirrors them for back and bottom', () => {
  expect(referencePose(bounds, 'front')).toEqual(presetPose(bounds, 'front'))
  const front = presetPose(bounds, 'front')
  const back = referencePose(bounds, 'back')
  expect(back.target).toEqual(front.target)
  expect(back.position[1]).toBeCloseTo(2 * front.target[1] - front.position[1])
  const top = presetPose(bounds, 'top')
  const bottom = referencePose(bounds, 'bottom')
  expect(bottom.position[2]).toBeCloseTo(2 * top.target[2] - top.position[2])
  expect(bottom.up).toEqual([0, 1, 0])
})
