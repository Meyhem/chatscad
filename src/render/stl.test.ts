import { asciiStl, binaryStl, BOX_TRI, type Tri } from '../test/stl'
import { parseStl } from './stl'

const FLAT: Tri = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
]

it('parses binary STL even when the header starts with "solid"', () => {
  const mesh = parseStl(binaryStl([FLAT, BOX_TRI]))
  expect(mesh.triangleCount).toBe(2)
  expect(Array.from(mesh.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
})

it('parses ASCII STL', () => {
  const mesh = parseStl(new TextEncoder().encode(asciiStl([FLAT])).buffer)
  expect(mesh.triangleCount).toBe(1)
  expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
})

it('computes flat unit normals from the vertices', () => {
  const mesh = parseStl(binaryStl([FLAT]))
  expect(Array.from(mesh.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1])
})

it('computes bounds', () => {
  expect(parseStl(binaryStl([BOX_TRI])).bounds).toEqual({ min: [0, 0, 0], max: [20, 20, 10] })
})

it('returns an empty mesh with zero bounds for zero triangles', () => {
  const mesh = parseStl(binaryStl([]))
  expect(mesh.triangleCount).toBe(0)
  expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
})

it('rejects data that is neither binary nor ASCII STL', () => {
  expect(() => parseStl(new TextEncoder().encode('hello').buffer)).toThrow('Unrecognised STL data')
})

it('rejects ASCII STL with a partial triangle', () => {
  const broken = 'solid x\n vertex 0 0 0\n vertex 1 0 0\nendsolid x'
  expect(() => parseStl(new TextEncoder().encode(broken).buffer)).toThrow('Malformed ASCII STL')
})
