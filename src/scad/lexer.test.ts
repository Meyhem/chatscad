import { lex, type Token } from './lexer'

const significant = (code: string) =>
  lex(code)
    .filter((t) => t.kind !== 'whitespace')
    .map((t) => [t.kind, t.text])

it('splits identifiers, numbers, strings and punctuation, with a leading minus as punctuation', () => {
  expect(significant('w = -40.5e1; $fn=8; s = "x";')).toEqual([
    ['ident', 'w'], ['punct', '='], ['punct', '-'], ['number', '40.5e1'], ['punct', ';'],
    ['ident', '$fn'], ['punct', '='], ['number', '8'], ['punct', ';'],
    ['ident', 's'], ['punct', '='], ['string', '"x"'], ['punct', ';'],
    ['eof', ''],
  ])
})

it('lexes numbers with a leading dot, a trailing dot and exponents', () => {
  expect(significant('.5 1. 2e-3 7E+2')).toEqual([
    ['number', '.5'], ['number', '1.'], ['number', '2e-3'], ['number', '7E+2'], ['eof', ''],
  ])
})

it('keeps // and /* inside a string as part of the string', () => {
  expect(significant('url = "http://x/*y*/"; // note')).toEqual([
    ['ident', 'url'], ['punct', '='], ['string', '"http://x/*y*/"'], ['punct', ';'], ['comment', '// note'], ['eof', ''],
  ])
})

it('handles escaped quotes and backslashes inside strings', () => {
  expect(significant(String.raw`a = "say \"hi\" \\"; b = 1;`).slice(0, 4)).toEqual([
    ['ident', 'a'], ['punct', '='], ['string', String.raw`"say \"hi\" \\"`], ['punct', ';'],
  ])
})

it('treats line and block comments as single tokens, even with quotes and code inside', () => {
  expect(significant(`// it's "fine" = 3;\n/* depth = 3; */\n/* [Group] */`)).toEqual([
    ['comment', `// it's "fine" = 3;`], ['comment', '/* depth = 3; */'], ['comment', '/* [Group] */'], ['eof', ''],
  ])
})

it('lexes include and use paths as one string token, including paths with //', () => {
  expect(significant('include <BOSL2/std.scad>\nuse <a//b.scad>\nx = a < b;')).toEqual([
    ['ident', 'include'], ['string', '<BOSL2/std.scad>'],
    ['ident', 'use'], ['string', '<a//b.scad>'],
    ['ident', 'x'], ['punct', '='], ['ident', 'a'], ['punct', '<'], ['ident', 'b'], ['punct', ';'],
    ['eof', ''],
  ])
})

it('keeps two-character operators together', () => {
  expect(significant('a<=b&&c!=d||e==f>=g').filter(([k]) => k === 'punct').map(([, t]) => t)).toEqual([
    '<=', '&&', '!=', '||', '==', '>=',
  ])
})

it('records start and end offsets and 1-based start lines', () => {
  const tokens = lex('a = 1;\n\n/* two\nlines */ b')
  const find = (text: string) => tokens.find((t) => t.text === text) as Token
  expect(find('a')).toMatchObject({ start: 0, end: 1, line: 1 })
  expect(find('/* two\nlines */')).toMatchObject({ line: 3 })
  expect(find('b')).toMatchObject({ line: 4 })
  expect(tokens.at(-1)).toMatchObject({ kind: 'eof', line: 4, start: 25, end: 25 })
})

it('runs an unterminated string or block comment to the end of the input', () => {
  expect(significant('s = "open')).toEqual([['ident', 's'], ['punct', '='], ['string', '"open'], ['eof', '']])
  expect(significant('/* open')).toEqual([['comment', '/* open'], ['eof', '']])
})

it('is lossless: the token texts join back into the source', () => {
  const code = 'include <x.scad>\n/* [A] */\nw = 40; // [10:1:200]\nmodule m() { cube([w, 2, -3.5]); }\n"unterminated'
  expect(lex(code).map((t) => t.text).join('')).toBe(code)
})
