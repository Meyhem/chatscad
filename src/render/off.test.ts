import { parseOff } from './off'

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

const OFF = [
  'OFF',
  '# written by a test',
  '5 3 0',
  '0 0 0',
  '10 0 0',
  '10 10 0',
  '0 10 0',
  '0 0 5',
  '3 0 1 2 0 0 1',
  '4 0 2 3 4 0 0 2',
  '3 0 1 4 249 215 44',
].join('\n')

it('reads vertices and fan-triangulates faces into a triangle soup', () => {
  const mesh = parseOff(encode(OFF), 2)
  expect(mesh.triangleCount).toBe(4)
  expect(Array.from(mesh.positions.slice(0, 9))).toEqual([0, 0, 0, 10, 0, 0, 10, 10, 0])
  expect(Array.from(mesh.positions.slice(9, 27))).toEqual([0, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 0, 0, 10, 0, 0, 0, 5])
  expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 5] })
  expect(mesh.normals).toHaveLength(mesh.positions.length)
})

it('decodes one tag per triangle, with 0 for colours that are not tags', () => {
  expect(Array.from(parseOff(encode(OFF), 2).faceTags ?? [])).toEqual([1, 2, 2, 0])
})

it('accepts float colours and counts on the header line', () => {
  const text = 'OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 0 0 0.00392156862745098\n'
  expect(Array.from(parseOff(encode(text), 1).faceTags ?? [])).toEqual([1])
})

it('gives faces without a colour tag 0', () => {
  const text = 'OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n'
  expect(Array.from(parseOff(encode(text), 5).faceTags ?? [])).toEqual([0])
})

it('rejects data that is not OFF', () => {
  expect(() => parseOff(encode('ply\nformat ascii 1.0\n'), 1)).toThrow('Unrecognised OFF data')
})

it('rejects a missing vertex and an out-of-range face index', () => {
  expect(() => parseOff(encode('OFF\n3 1 0\n0 0 0\n1 0 0\n'), 1)).toThrow('Malformed OFF vertex')
  expect(() => parseOff(encode('OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 7\n'), 1)).toThrow('Malformed OFF face')
  expect(() => parseOff(encode('OFF\nx y z\n'), 1)).toThrow('Malformed OFF header')
})
