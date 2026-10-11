import { formatCost, formatTokens } from './format'

it('formats token counts with thousands separators and the unit', () => {
  expect(formatTokens(2310)).toBe('2,310 tok')
  expect(formatTokens(0)).toBe('0 tok')
  expect(formatTokens(412118)).toBe('412,118 tok')
  expect(formatTokens(12.6)).toBe('13 tok')
})

it('formats cost with 3 decimals under $1 and 2 decimals from $1', () => {
  expect(formatCost(0.011)).toBe('$0.011')
  expect(formatCost(0.0114)).toBe('$0.011')
  expect(formatCost(0.0001)).toBe('$0.000')
  expect(formatCost(0)).toBe('$0.000')
  expect(formatCost(1.844)).toBe('$1.84')
  expect(formatCost(0.9996)).toBe('$1.00')
  expect(formatCost(1234.5)).toBe('$1,234.50')
})

it('says "price unknown" when there is no price', () => {
  expect(formatCost(null)).toBe('price unknown')
})
