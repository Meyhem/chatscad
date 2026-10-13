import { cleanChecks, CHECK_KIND_LABEL, MAX_CHECKS, newCheck, parseCheckKind } from './checks'

it('reads a check kind in any case and falls back to other', () => {
  expect(parseCheckKind('Size')).toBe('size')
  expect(parseCheckKind('PRINT')).toBe('print')
  expect(parseCheckKind('colour')).toBe('other')
  expect(parseCheckKind(4)).toBe('other')
  expect(CHECK_KIND_LABEL.feature).toBe('Feature')
})

it('makes a check with an id and trimmed text', () => {
  const c = newCheck('part', '  A lid  ')
  expect(c).toMatchObject({ kind: 'part', text: 'A lid' })
  expect(c.id).toMatch(/^[0-9a-f-]{36}$/)
})

it('keeps well-formed checks, drops empty ones, caps the count and the length', () => {
  const long = 'x'.repeat(500)
  const raw = [
    { kind: 'size', text: 'Walls at least 2 mm' },
    { kind: 'part', text: '   ' },
    { text: long },
    'not a check',
    ...Array.from({ length: 30 }, (_, i) => ({ kind: 'fit', text: `Check ${i}` })),
  ]
  const checks = cleanChecks(raw)
  expect(checks).toHaveLength(MAX_CHECKS)
  expect(checks[0]).toMatchObject({ kind: 'size', text: 'Walls at least 2 mm' })
  expect(checks[1].kind).toBe('other')
  expect(checks[1].text).toHaveLength(200)
  expect(cleanChecks('nope')).toEqual([])
})

it('keeps ids it is given, so stored checks keep theirs', () => {
  expect(cleanChecks([{ id: 'c1', kind: 'part', text: 'Lid' }])[0].id).toBe('c1')
})
