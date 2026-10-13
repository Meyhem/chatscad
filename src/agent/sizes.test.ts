import { sizeRows, sizesSummary } from './sizes'

const CODE = ['rod_d = 25; // [15:0.5:40] from description', 'plate_w = 22; // [14:1:40] from photo', 'wall = 3; // [1.2:0.2:6] guessed', 'shape = "round"; // [round, square]', 'cup_depth = 24; // [10:1:40] guessed'].join('\n')

it('lists every parameter with its value, unit and source, guessed first', () => {
  const rows = sizeRows(CODE, { wall: 3.4 })
  expect(rows.map((r) => r.name)).toEqual(['wall', 'cup_depth', 'plate_w', 'rod_d', 'shape'])
  expect(rows[0]).toEqual({ name: 'wall', value: 3.4, unit: 'mm', source: 'guess' })
  expect(rows[4]).toEqual({ name: 'shape', value: 'round', unit: '', source: null })
})

it('summarises the card for the chat note', () => {
  expect(sizesSummary(sizeRows(CODE, {}), 'v1')).toBe('Sizes in v1 · 5 · 2 guessed')
  expect(sizesSummary(sizeRows('a = 1;', {}), null)).toBe('Sizes · 1 · source not given')
})
