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

it('reuses the export presets for front and side, and mirrors front for back', () => {
  expect(referencePose(bounds, 'front')).toEqual(presetPose(bounds, 'front'))
  expect(referencePose(bounds, 'right')).toEqual(presetPose(bounds, 'right'))
  const front = presetPose(bounds, 'front')
  const back = referencePose(bounds, 'back')
  expect(back.target).toEqual(front.target)
  expect(back.position[1]).toBeCloseTo(2 * front.target[1] - front.position[1])
})

// The live viewer keeps camera.up at +Z (OrbitControls assumes it), so top and bottom look along Z from a hair off the axis.
it.each(['top', 'bottom'] as const)('%s looks along Z without changing the up vector', (view) => {
  const preset = presetPose(bounds, 'top')
  const pose = referencePose(bounds, view)
  const distance = preset.position[2] - preset.target[2]
  expect(pose.up).toBeUndefined()
  expect(pose.target).toEqual(preset.target)
  expect(pose.position[0]).toBeCloseTo(preset.target[0])
  expect(pose.position[1]).toBeLessThan(preset.target[1])
  expect(preset.target[1] - pose.position[1]).toBeLessThan(0.01 * distance)
  expect(pose.position[2] - preset.target[2]).toBeCloseTo(view === 'top' ? distance : -distance, 3)
})
