import { StreamLanguage, type StreamParser } from '@codemirror/language'

const KEYWORDS = new Set([
  'module', 'function', 'if', 'else', 'for', 'let', 'each', 'include', 'use',
  'true', 'false', 'undef', 'intersection_for', 'assert', 'echo',
])

const BUILTINS = new Set([
  'cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'text', 'import', 'surface',
  'union', 'difference', 'intersection', 'translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'color',
  'offset', 'hull', 'minkowski', 'resize', 'linear_extrude', 'rotate_extrude', 'projection', 'render',
  'children', 'abs', 'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'floor', 'round', 'ceil',
  'ln', 'log', 'pow', 'sqrt', 'exp', 'min', 'max', 'norm', 'cross', 'len', 'concat', 'lookup', 'str', 'chr',
  'ord', 'search', 'rands', 'is_num', 'is_string', 'is_bool', 'is_list', 'is_undef', 'is_function',
])

export const openscadParser: StreamParser<{ inComment: boolean }> = {
  name: 'openscad',
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/')
        state.inComment = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inComment = true
      return 'comment'
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i)) return 'number'
    if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) return 'atom'
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current()
      if (KEYWORDS.has(word)) return 'keyword'
      if (BUILTINS.has(word)) return 'builtin'
      return 'variableName'
    }
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
}

export const openscad = () => StreamLanguage.define(openscadParser)
