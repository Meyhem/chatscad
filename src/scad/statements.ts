import { lex, type Token } from './lexer'

export interface StatementRange {
  tag: number
  label: string
  startLine: number
  endLine: number
  start: number
  end: number
}

export interface LineRange {
  startLine: number
  endLine: number
}

export interface ModuleDefinition extends LineRange {
  name: string
  start: number
  end: number
}

const BOOLEANS = new Set(['union', 'difference', 'intersection'])
const TRANSFORMS = new Set(['translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'color', 'resize', 'offset', 'render'])
const NO_GEOMETRY = new Set(['echo', 'assert'])
const OPENERS = '([{'
const CLOSERS = ')]}'

type Kind = 'object' | 'module' | 'function' | 'include' | 'assignment'

interface Scanned {
  kind: Kind
  /** Index of the first and last significant token. */
  first: number
  last: number
  /** Call names at bracket depth 0, in order: `translate([..]) cube(..)` → ['translate', 'cube']. */
  names: string[]
  /** Index of the first `{` at depth 0, if any. */
  blockOpen: number | null
  disabled: boolean
  defName: string | null
}

interface Parsed {
  toks: Token[]
  top: Scanned[]
  modules: Set<string>
  lineAt(offset: number): number
}

function significant(code: string): Token[] {
  return lex(code).filter((t) => t.kind !== 'comment' && t.kind !== 'whitespace' && t.kind !== 'eof')
}

function isPunct(t: Token | undefined, text: string): boolean {
  return t?.kind === 'punct' && t.text === text
}

function lineLocator(code: string): (offset: number) => number {
  const starts = [0]
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

/** The token ending the statement that starts at `i`: a `;` or the `}` that closes its block at depth 0. `else` continues it. */
function statementEnd(toks: Token[], i: number, limit: number): number {
  let depth = 0
  for (let j = i; j < limit; j++) {
    const t = toks[j]
    if (t.kind !== 'punct') continue
    let ended = false
    for (const ch of t.text) {
      if (OPENERS.includes(ch)) depth++
      else if (CLOSERS.includes(ch)) {
        depth--
        if (ch === '}' && depth === 0) ended = true
      } else if (ch === ';' && depth === 0) ended = true
    }
    const next = toks[j + 1]
    if (ended && !(next?.kind === 'ident' && next.text === 'else')) return j
  }
  return limit - 1
}

function matchingClose(toks: Token[], open: number, limit: number): number {
  let depth = 0
  for (let j = open; j < limit; j++) {
    const t = toks[j]
    if (t.kind !== 'punct') continue
    for (const ch of t.text) {
      if (OPENERS.includes(ch)) depth++
      else if (CLOSERS.includes(ch)) depth--
    }
    if (depth === 0) return j
  }
  return limit
}

function classify(toks: Token[], first: number, last: number): Scanned {
  const empty = { first, last, names: [], blockOpen: null, disabled: false, defName: null }
  const head = toks[first]
  if (head.kind === 'ident' && head.text === 'module') return { ...empty, kind: 'module', defName: toks[first + 1]?.text ?? null }
  if (head.kind === 'ident' && head.text === 'function') return { ...empty, kind: 'function', defName: toks[first + 1]?.text ?? null }

  let i = first
  let disabled = false
  while (i <= last && toks[i].kind === 'punct' && /^[!#%*]+$/.test(toks[i].text)) {
    if (toks[i].text.includes('*')) disabled = true
    i++
  }

  const names: string[] = []
  let blockOpen: number | null = null
  let depth = 0
  for (let j = i; j <= last; j++) {
    const t = toks[j]
    if (t.kind === 'punct') {
      const isAssign = t.text.startsWith('=') && t.text !== '==' && !isPunct(toks[j + 1], '=')
      if (depth === 0 && names.length === 0 && isAssign) return { ...empty, kind: 'assignment' }
      if (depth === 0 && blockOpen === null && t.text.startsWith('{')) blockOpen = j
      for (const ch of t.text) {
        if (OPENERS.includes(ch)) depth++
        else if (CLOSERS.includes(ch)) depth--
      }
    } else if (t.kind === 'ident' && depth === 0) {
      const next = toks[j + 1]
      if (next?.kind === 'punct' && next.text.startsWith('(')) names.push(t.text)
    }
  }
  return { ...empty, kind: 'object', names, blockOpen, disabled }
}

function scanStatements(toks: Token[], from: number, to: number): Scanned[] {
  const out: Scanned[] = []
  let i = from
  while (i < to) {
    const t = toks[i]
    if (isPunct(t, ';')) {
      i++
      continue
    }
    if (t.kind === 'ident' && (t.text === 'include' || t.text === 'use') && toks[i + 1]?.text.startsWith('<')) {
      let j = i
      while (j + 1 < to && toks[j + 1].line === t.line) j++
      out.push({ kind: 'include', first: i, last: j, names: [], blockOpen: null, disabled: false, defName: null })
      i = j + 1
      continue
    }
    const last = statementEnd(toks, i, to)
    out.push(classify(toks, i, last))
    i = last + 1
  }
  return out
}

function parse(code: string): Parsed {
  const toks = significant(code)
  const top = scanStatements(toks, 0, toks.length)
  const modules = new Set(top.flatMap((s) => (s.kind === 'module' && s.defName ? [s.defName] : [])))
  return { toks, top, modules, lineAt: lineLocator(code) }
}

function isGeometry(s: Scanned): boolean {
  if (s.kind !== 'object' || s.disabled) return false
  return !(s.names.length > 0 && s.names.every((n) => NO_GEOMETRY.has(n)))
}

function labelFor(names: string[], modules: ReadonlySet<string>): string {
  const userModule = [...names].reverse().find((n) => modules.has(n))
  if (userModule) return userModule
  const first = names.find((n) => !TRANSFORMS.has(n)) ?? names[0]
  if (first === undefined) return 'block'
  if (first === 'for' || first === 'intersection_for') return 'for loop'
  if (first === 'if') return 'if block'
  return first
}

export function listTaggableStatements(code: string): StatementRange[] {
  const { toks, top, modules, lineAt } = parse(code)
  const chosen: Scanned[] = []
  for (const s of top) {
    if (!isGeometry(s)) continue
    const lastName = s.names.at(-1)
    if (lastName !== undefined && BOOLEANS.has(lastName) && s.blockOpen !== null) {
      const close = matchingClose(toks, s.blockOpen, s.last + 1)
      const children = scanStatements(toks, s.blockOpen + 1, close).filter(isGeometry)
      if (children.length > 0) {
        chosen.push(...children)
        continue
      }
    }
    chosen.push(s)
  }
  return chosen.map((s, i) => {
    const start = toks[s.first].start
    const end = toks[s.last].end
    return {
      tag: i + 1,
      label: labelFor(s.names, modules),
      startLine: lineAt(start),
      endLine: lineAt(Math.max(start, end - 1)),
      start,
      end,
    }
  })
}

export function listModuleDefinitions(code: string): ModuleDefinition[] {
  const { toks, top, lineAt } = parse(code)
  return top.flatMap((s) => {
    if (s.kind !== 'module' || s.defName === null) return []
    const start = toks[s.first].start
    const end = toks[s.last].end
    return [{ name: s.defName, start, end, startLine: lineAt(start), endLine: lineAt(Math.max(start, end - 1)) }]
  })
}

function countModuleCalls(code: string, name: string): number {
  const toks = significant(code)
  let calls = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const next = toks[i + 1]
    const prev = toks[i - 1]
    const isDefinition = prev?.kind === 'ident' && prev.text === 'module'
    if (t.kind === 'ident' && t.text === name && next?.kind === 'punct' && next.text.startsWith('(') && !isDefinition) calls++
  }
  return calls
}

export function resolveEditScope(code: string, statement: StatementRange): LineRange {
  const definition = listModuleDefinitions(code).find((d) => d.name === statement.label)
  if (definition && countModuleCalls(code, definition.name) === 1) {
    return { startLine: definition.startLine, endLine: definition.endLine }
  }
  return { startLine: statement.startLine, endLine: statement.endLine }
}

export function statementKind(code: string, statement: StatementRange): string {
  return listModuleDefinitions(code).some((d) => d.name === statement.label) ? 'module call' : statement.label
}

export function formatLines({ startLine, endLine }: LineRange): string {
  return startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`
}
