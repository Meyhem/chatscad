import { Text } from '@codemirror/state'
import { calloutHeadline, diagnosticsByLine } from './diagnosticsExtension'

const doc = Text.of(['cube(1);', 'sphere(', 'x'])

it('keeps one diagnostic per line, preferring errors over warnings, sorted by line', () => {
  const result = diagnosticsByLine(doc, [
    { line: 3, severity: 'warning', message: 'w3' },
    { line: 2, severity: 'warning', message: 'w2' },
    { line: 2, severity: 'error', message: 'e2' },
    { line: 2, severity: 'warning', message: 'w2 again' },
  ])
  expect(result).toEqual([
    { line: 2, severity: 'error', message: 'e2' },
    { line: 3, severity: 'warning', message: 'w3' },
  ])
})

it('clamps lines outside the document instead of throwing', () => {
  expect(diagnosticsByLine(doc, [{ line: 99, severity: 'error', message: 'late' }, { line: 0, severity: 'warning', message: 'early' }])).toEqual([
    { line: 1, severity: 'warning', message: 'early' },
    { line: 3, severity: 'error', message: 'late' },
  ])
})

it('writes the headline in the design system voice', () => {
  expect(calloutHeadline({ line: 16, severity: 'error', message: 'Parser error: syntax error' })).toBe(
    'Line 16: Parser error: syntax error',
  )
})
