import { parseDiagnosticLine, parseDiagnostics } from './diagnostics'
import type { LogLine } from './types'

const err = (text: string): LogLine => ({ stream: 'stderr', text })

it('maps parser errors in main.scad to a line and strips the location clause', () => {
  expect(parseDiagnostics([err('ERROR: Parser error in file "/main.scad", line 3: syntax error')])).toEqual([
    { severity: 'error', line: 3, message: 'Parser error: syntax error' },
  ])
})

it('maps warnings with an unquoted file name', () => {
  expect(parseDiagnostics([err("WARNING: Ignoring unknown variable 'x' in file main.scad, line 2")])).toEqual([
    { severity: 'warning', line: 2, message: "Ignoring unknown variable 'x'" },
  ])
})

it('ignores lines without a location, other files, and non-diagnostic output', () => {
  expect(
    parseDiagnostics([
      err('ERROR: Current top level object is empty.'),
      err('WARNING: something in file /lib/BOSL2/std.scad, line 9'),
      { stream: 'stdout', text: 'ECHO: 42' },
      err('TRACE: called by module'),
    ]),
  ).toEqual([])
})

it('parses a single line, returning null for anything that is not a located diagnostic', () => {
  expect(parseDiagnosticLine('WARNING: variable w not specified as parameter, in file main.scad, line 12')).toEqual({
    severity: 'warning',
    line: 12,
    message: 'variable w not specified as parameter',
  })
  expect(parseDiagnosticLine('ECHO: "wall = 2"')).toBeNull()
  expect(parseDiagnosticLine('ERROR: Execution aborted')).toBeNull()
})
