import { formatDimParts, formatDims, formatLength } from './dims'

it('formats bounding box size in mm with the multiplication sign', () => {
  expect(formatDims({ min: [0, 0, 0], max: [20, 20, 10] })).toBe('20 × 20 × 10 mm')
})

it('rounds to two decimals and trims zeros', () => {
  expect(formatDims({ min: [-1, 0, 0], max: [1.5, 0.333333, 2] })).toBe('2.5 × 0.33 × 2 mm')
})

it('exposes the three sides separately for the axis readout', () => {
  expect(formatDimParts({ min: [0, 0, 0], max: [88.8, 25.4, 22] })).toEqual(['88.8', '25.4', '22'])
})

it('formats one length in mm', () => {
  expect(formatLength(40)).toBe('40 mm')
  expect(formatLength(12.5)).toBe('12.5 mm')
  expect(formatLength(0)).toBe('0 mm')
})
