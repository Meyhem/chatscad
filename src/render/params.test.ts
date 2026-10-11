import { paramsEqual, paramValueEqual } from './params'

it('compares scalar and vector parameter values', () => {
  expect(paramValueEqual(1, 1)).toBe(true)
  expect(paramValueEqual('a', 'a')).toBe(true)
  expect(paramValueEqual(true, false)).toBe(false)
  expect(paramValueEqual([1, 2], [1, 2])).toBe(true)
  expect(paramValueEqual([1, 2], [1, 2, 3])).toBe(false)
  expect(paramValueEqual([1], 1)).toBe(false)
})

it('compares parameter maps by keys and values, treating null as empty', () => {
  expect(paramsEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true)
  expect(paramsEqual({ a: 1 }, { a: 2 })).toBe(false)
  expect(paramsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  expect(paramsEqual(null, {})).toBe(true)
  expect(paramsEqual(undefined, { a: 1 })).toBe(false)
})
