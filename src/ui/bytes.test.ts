import { formatMegabytes, formatSize } from './bytes'

it('formats megabytes with one decimal', () => {
  expect(formatMegabytes(11_000_303)).toBe('11.0')
  expect(formatMegabytes(5_240_000)).toBe('5.2')
})

it('formats sizes in KB below 1 MB and in MB above', () => {
  expect(formatSize(9_400)).toBe('9.4 KB')
  expect(formatSize(940)).toBe('0.9 KB')
  expect(formatSize(1_600_000)).toBe('1.6 MB')
})
