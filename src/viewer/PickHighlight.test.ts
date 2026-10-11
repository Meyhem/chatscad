import { boxFor, PICK_FILL_OPACITY } from './PickHighlight'

it('fills picked parts at the screen opacity', () => {
  expect(PICK_FILL_OPACITY).toBe(0.22)
})

it('centres the region box on the bounds and never makes a side zero', () => {
  expect(boxFor({ min: [0, 0, 0], max: [10, 4, 0] })).toEqual({ center: [5, 2, 0], size: [10, 4, 0.01] })
})
