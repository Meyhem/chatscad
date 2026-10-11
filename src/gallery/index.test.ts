import { parseCustomizer } from '../scad/customizer'
import { CATEGORIES, EXAMPLES } from './index'

it('ships the eight examples from the Gallery screen, in its order, with its parameter counts and tags', () => {
  expect(EXAMPLES.map((e) => [e.name, parseCustomizer(e.code).length, e.category, e.tags.join(' / ')])).toEqual([
    ['Box with lid', 6, 'Storage', 'storage / snap-fit'],
    ['Enclosure', 9, 'Storage', 'electronics / screw bosses'],
    ['L bracket', 7, 'Mounting', 'mounting / M3 / M4'],
    ['Knob', 5, 'Mechanical', 'D-shaft / knurled'],
    ['Spur gear', 6, 'Mechanical', 'mechanical / module 1'],
    ['Print-in-place hinge', 5, 'Mechanical', 'mechanical / no supports'],
    ['Cable clip', 4, 'Desk', 'desk / adhesive'],
    ['Phone stand', 4, 'Desk', 'desk / angle'],
  ])
  expect(CATEGORIES).toEqual(['Storage', 'Mounting', 'Mechanical', 'Desk'])
  expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(8)
})

it('describes and annotates every parameter, groups them, and needs no library', () => {
  for (const example of EXAMPLES) {
    const params = parseCustomizer(example.code)
    for (const p of params) {
      expect(p.description, `${example.id}: ${p.name}`).not.toBe('')
      expect(p.group, `${example.id}: ${p.name}`).not.toBe('')
      if (p.control.kind === 'number') throw new Error(`${example.id}: ${p.name} has no annotation`)
    }
    expect(example.code).not.toMatch(/^\s*(include|use)\s*</m)
    expect(example.code).toMatch(/^module \w+\(/m)
    expect(example.glyph.length).toBeGreaterThanOrEqual(3)
  }
})
