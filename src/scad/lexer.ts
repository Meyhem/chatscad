export type TokenKind = 'ident' | 'number' | 'string' | 'punct' | 'comment' | 'whitespace' | 'eof'

export interface Token {
  kind: TokenKind
  text: string
  start: number
  end: number
  /** 1-based line the token starts on. */
  line: number
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const TWO_CHAR = new Set(['==', '!=', '<=', '>=', '&&', '||'])

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n'
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdentPart = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c)

/** Comment-, string- and include-path-aware tokens for the Customizer and statement scanners (D7). */
export function lex(code: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  // After `include` or `use`, the next `<…>` is a file path, not a comparison.
  let expectPath = false

  const push = (kind: TokenKind, end: number) => {
    tokens.push({ kind, text: code.slice(i, end), start: i, end, line })
    for (let k = i; k < end; k++) if (code.charCodeAt(k) === 10) line++
    i = end
  }

  while (i < code.length) {
    const c = code[i]!

    if (isSpace(c)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j]!)) j++
      push('whitespace', j)
      continue
    }

    if (c === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i)
      push('comment', nl === -1 ? code.length : nl)
      continue
    }

    if (c === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2)
      push('comment', close === -1 ? code.length : close + 2)
      continue
    }

    if (c === '"') {
      let j = i + 1
      while (j < code.length && code[j] !== '"') j += code[j] === '\\' ? 2 : 1
      push('string', Math.min(j + 1, code.length))
      expectPath = false
      continue
    }

    if (expectPath && c === '<') {
      const close = code.indexOf('>', i)
      const nl = code.indexOf('\n', i)
      const end = close !== -1 && (nl === -1 || close < nl) ? close + 1 : nl === -1 ? code.length : nl
      push('string', end)
      expectPath = false
      continue
    }

    if (isDigit(c) || (c === '.' && isDigit(code[i + 1]))) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(code)!
      push('number', i + m[0].length)
      expectPath = false
      continue
    }

    if (isIdentStart(c)) {
      let j = i + 1
      while (isIdentPart(code[j])) j++
      const word = code.slice(i, j)
      push('ident', j)
      expectPath = word === 'include' || word === 'use'
      continue
    }

    push('punct', i + (TWO_CHAR.has(code.slice(i, i + 2)) ? 2 : 1))
    expectPath = false
  }

  tokens.push({ kind: 'eof', text: '', start: code.length, end: code.length, line })
  return tokens
}
