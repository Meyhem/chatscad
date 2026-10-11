import { StringStream } from '@codemirror/language'
import { openscadParser } from './openscadLanguage'

function tokens(line: string, state = openscadParser.startState!(2)) {
  const stream = new StringStream(line, 2, 2)
  const out: [string, string | null][] = []
  while (!stream.eol()) {
    const style = openscadParser.token(stream, state)
    if (stream.current().trim()) out.push([stream.current(), style ?? null])
    stream.start = stream.pos
  }
  return { out, state }
}

it('classifies keywords, builtins, numbers, strings and special variables', () => {
  expect(tokens('module m() cube([1.5, 2e3]) "a\\"b" $fn').out).toEqual([
    ['module', 'keyword'],
    ['m', 'variableName'],
    ['(', null],
    [')', null],
    ['cube', 'builtin'],
    ['(', null],
    ['[', null],
    ['1.5', 'number'],
    [',', null],
    ['2e3', 'number'],
    [']', null],
    [')', null],
    ['"a\\"b"', 'string'],
    ['$fn', 'atom'],
  ])
})

it('handles line comments and block comments spanning lines', () => {
  expect(tokens('x // note').out).toEqual([
    ['x', 'variableName'],
    ['// note', 'comment'],
  ])
  const first = tokens('a /* start')
  expect(first.out[0]).toEqual(['a', 'variableName'])
  expect(first.out.slice(1).every(([, style]) => style === 'comment')).toBe(true)
  expect(first.state.inComment).toBe(true)
  const second = tokens('still */ b', first.state)
  expect(second.out).toEqual([
    ['still */', 'comment'],
    ['b', 'variableName'],
  ])
})
