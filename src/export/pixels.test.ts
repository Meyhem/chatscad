import { flipRows } from './pixels'

it('turns WebGL bottom-up rows into top-down ImageData rows', () => {
  const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  expect([...flipRows(pixels, 1, 3)]).toEqual([9, 10, 11, 12, 5, 6, 7, 8, 1, 2, 3, 4])
})
