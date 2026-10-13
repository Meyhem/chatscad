import { Color } from 'three'
import { faceColourArray, partColourName, partToken, PART_COLOUR_COUNT } from './partColours'

const COLOURS = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7']
const NONE = '#a3a9b1'

const rgb = (hex: string) => {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}

it('maps tags to the seven part tokens, repeating after seven, and 0 to part-none', () => {
  expect(PART_COLOUR_COUNT).toBe(7)
  expect(partToken(1)).toBe('part-1')
  expect(partToken(7)).toBe('part-7')
  expect(partToken(8)).toBe('part-1')
  expect(partToken(0)).toBe('part-none')
})

it('names colours in plain words for the reviewer prompt', () => {
  expect(partColourName(1)).toBe('orange')
  expect(partColourName(2)).toBe('sky blue')
  expect(partColourName(9)).toBe('sky blue')
  expect(partColourName(0)).toBe('grey')
})

it('gives every vertex of a triangle its part colour', () => {
  const array = faceColourArray(new Uint32Array([1, 0, 9]), COLOURS, NONE)
  expect(array).toHaveLength(27)
  const triangle = (i: number) => Array.from(array.slice(i * 9, i * 9 + 9))
  const three = (c: number[]) => [...c, ...c, ...c]
  expect(triangle(0)).toEqual(three(rgb(COLOURS[0])).map((v) => Math.fround(v)))
  expect(triangle(1)).toEqual(three(rgb(NONE)).map((v) => Math.fround(v)))
  expect(triangle(2)).toEqual(three(rgb(COLOURS[1])).map((v) => Math.fround(v)))
})
