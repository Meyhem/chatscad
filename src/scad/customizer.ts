import { paramValueEqual, type Params } from '../render/params'
import type { ParamValue } from '../render/types'
import { lex, type Token } from './lexer'

export type ParamControl =
  | { kind: 'slider'; min: number; step: number; max: number }
  | { kind: 'number'; step?: number }
  | { kind: 'dropdown'; options: Array<{ value: string | number; label: string }> }
  | { kind: 'toggle' }
  | { kind: 'text' }
  | { kind: 'vector'; length: number }

/** Where a size came from, from the words after the Customizer annotation (spec P7). */
export type ParamSource = 'description' | 'photo' | 'guess' | null

export const SOURCE_LABEL: Record<Exclude<ParamSource, null>, string> = {
  description: 'From description',
  photo: 'From photo',
  guess: 'Guessed',
}

export interface CustomizerParam {
  name: string
  defaultValue: ParamValue
  control: ParamControl
  group: string // '' when no /* [Group] */ precedes it
  description: string // comment on the line above, if any
  line: number
  annotated: boolean
  source: ParamSource
}

interface Assignment {
  name: string
  value: ParamValue
  valueStart: number
  valueEnd: number
  line: number
  group: string
  hidden: boolean
  description: string
  annotation: string | null
  source: ParamSource
}

const GROUP = /^\/\*\s*\[\s*([^\]]*?)\s*\]\s*\*\/$/
const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const OPEN = new Set(['(', '[', '{'])
const CLOSE = new Set([')', ']', '}'])

const isTrivia = (t: Token) => t.kind === 'whitespace' || t.kind === 'comment'

function nextSignificant(tokens: Token[], from: number): number {
  let j = from
  while (j < tokens.length && isTrivia(tokens[j]!)) j++
  return j
}

/** Index of the `;` that ends the statement starting at `from`, or -1 if it is malformed. */
function statementEnd(tokens: Token[], from: number): number {
  let depth = 0
  for (let j = from; j < tokens.length; j++) {
    const t = tokens[j]!
    if (t.kind === 'eof') return -1
    if (t.kind !== 'punct') continue
    if (OPEN.has(t.text)) depth++
    else if (CLOSE.has(t.text)) {
      if (depth === 0) return -1
      depth--
    } else if (t.text === ';' && depth === 0) return j
  }
  return -1
}

function unescape(body: string): string {
  return body.replace(/\\(.)/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c)
}

function readNumber(ts: Token[], k: number): [number, number] | null {
  const negative = ts[k]?.text === '-'
  const t = ts[negative ? k + 1 : k]
  if (!t || t.kind !== 'number') return null
  const n = Number(t.text)
  if (!Number.isFinite(n)) return null
  return [negative ? -n : n, negative ? k + 2 : k + 1]
}

function parseLiteral(ts: Token[]): ParamValue | undefined {
  if (ts.length === 0) return undefined
  const first = ts[0]!
  if (ts.length === 1) {
    if (first.kind === 'string' && first.text.length >= 2 && first.text.startsWith('"') && first.text.endsWith('"')) {
      return unescape(first.text.slice(1, -1))
    }
    if (first.kind === 'ident' && (first.text === 'true' || first.text === 'false')) return first.text === 'true'
  }
  const scalar = readNumber(ts, 0)
  if (scalar && scalar[1] === ts.length) return scalar[0]
  if (first.text !== '[' || ts.at(-1)!.text !== ']') return undefined
  const items: number[] = []
  let k = 1
  while (k < ts.length - 1) {
    const n = readNumber(ts, k)
    if (!n) return undefined
    items.push(n[0])
    k = n[1]
    if (k < ts.length - 1) {
      if (ts[k]!.text !== ',') return undefined
      k++
    }
  }
  return items.length >= 1 && items.length <= 4 ? items : undefined
}

function descriptionAbove(tokens: Token[], identIndex: number): string {
  let j = identIndex - 1
  const ws = tokens[j]
  if (!ws || ws.kind !== 'whitespace' || ws.text.split('\n').length !== 2) return ''
  j--
  const c = tokens[j]
  if (!c || c.kind !== 'comment' || GROUP.test(c.text)) return ''
  const before = tokens[j - 1]
  if (before && !(before.kind === 'whitespace' && before.text.includes('\n'))) return ''
  return c.text.startsWith('//') ? c.text.slice(2).trim() : c.text.slice(2, -2).trim()
}

function annotationAfter(tokens: Token[], semicolon: number): string | null {
  let j = semicolon + 1
  if (tokens[j]?.kind === 'whitespace') {
    if (tokens[j]!.text.includes('\n')) return null
    j++
  }
  const c = tokens[j]
  return c?.kind === 'comment' && c.text.startsWith('//') ? c.text.slice(2).trim() : null
}

const SOURCE = /\s*(from (?:the )?description|from (?:the )?photos?|guessed)\s*$/i

/** A bracketed annotation followed by other words keeps only the bracket; "[[1, 2]]" has no gap after the first "]", so it stays whole and unusable. */
function cutAtBracket(text: string): string {
  if (!text.startsWith('[')) return text
  const close = text.indexOf(']')
  return close !== -1 && /^\s/.test(text.slice(close + 1)) ? text.slice(0, close + 1) : text
}

/** Splits "[1:10] guessed" into the annotation and the source; other trailing words after a bracket are dropped. */
export function splitSource(text: string | null): { annotation: string | null; source: ParamSource } {
  if (text === null) return { annotation: null, source: null }
  const m = SOURCE.exec(text)
  const source: ParamSource = !m ? null : m[1]!.toLowerCase() === 'guessed' ? 'guess' : m[1]!.toLowerCase().includes('photo') ? 'photo' : 'description'
  const rest = (m ? text.slice(0, m.index) : text).trim()
  return { annotation: rest === '' ? null : cutAtBracket(rest), source }
}

function scanAssignments(code: string): Assignment[] {
  const tokens = lex(code)
  const found = new Map<string, Assignment>()
  let group = ''
  let hidden = false
  let depth = 0
  let atStart = true

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === 'eof') break
    if (t.kind === 'whitespace') continue
    if (t.kind === 'comment') {
      const m = depth === 0 ? GROUP.exec(t.text) : null
      if (m) {
        hidden = m[1]!.toLowerCase() === 'hidden'
        group = hidden ? '' : m[1]!
      }
      continue
    }

    if (depth === 0 && atStart && t.kind === 'ident') {
      if (t.text === 'module' || t.text === 'function') break
      const next = nextSignificant(tokens, i + 1)
      if ((t.text === 'include' || t.text === 'use') && tokens[next]?.kind === 'string') {
        i = next
        continue
      }
      if (tokens[next]?.text === '=') {
        const end = statementEnd(tokens, next + 1)
        if (end !== -1) {
          const valueTokens = tokens.slice(next + 1, end).filter((x) => !isTrivia(x))
          const value = parseLiteral(valueTokens)
          found.delete(t.text)
          if (value !== undefined && !t.text.startsWith('$')) {
            found.set(t.text, {
              name: t.text,
              value,
              valueStart: valueTokens[0]!.start,
              valueEnd: valueTokens.at(-1)!.end,
              line: t.line,
              group,
              hidden,
              description: descriptionAbove(tokens, i),
              ...splitSource(annotationAfter(tokens, end)),
            })
          }
          i = end
          atStart = true
          continue
        }
      }
    }

    if (t.kind === 'punct') {
      if (OPEN.has(t.text)) depth++
      else if (CLOSE.has(t.text)) depth = Math.max(0, depth - 1)
    }
    atStart = depth === 0 && (t.text === ';' || t.text === '}')
  }
  return [...found.values()]
}

const decimals = (n: number) => {
  const s = String(n)
  const dot = s.indexOf('.')
  return dot === -1 || s.includes('e') ? 0 : s.length - dot - 1
}

function parseAnnotation(text: string, value: number | string): ParamControl | null {
  const bracket = /^\[([^[\]]*)\]$/.exec(text)
  if (!bracket) {
    if (typeof value === 'number' && NUM.test(text) && Number(text) > 0) return { kind: 'number', step: Number(text) }
    return null
  }
  const inner = bracket[1]!.trim()
  if (inner === '') return null
  const items = inner.split(',').map((s) => s.trim())

  if (items.length === 1 && typeof value === 'number') {
    const parts = items[0]!.split(':').map((s) => s.trim())
    if (parts.every((p) => NUM.test(p))) {
      const n = parts.map(Number)
      let min: number, step: number, max: number
      if (n.length === 1) [min, step, max] = [0, 1, n[0]!]
      else if (n.length === 2) {
        ;[min, max] = [n[0]!, n[1]!]
        step = 10 ** -Math.max(decimals(min), decimals(max), decimals(value))
      } else if (n.length === 3) [min, step, max] = [n[0]!, n[1]!, n[2]!]
      else return null
      return min < max && step > 0 ? { kind: 'slider', min, step, max } : null
    }
  }

  const options: Array<{ value: string | number; label: string }> = []
  for (const item of items) {
    const colon = item.indexOf(':')
    const raw = (colon === -1 ? item : item.slice(0, colon)).trim()
    const label = (colon === -1 ? item : item.slice(colon + 1)).trim()
    if (raw === '' || label === '') return null
    if (typeof value === 'number') {
      if (!NUM.test(raw)) return null
      options.push({ value: Number(raw), label })
    } else options.push({ value: raw, label })
  }
  return { kind: 'dropdown', options }
}

function toParam(a: Assignment): CustomizerParam {
  const base = { name: a.name, defaultValue: a.value, group: a.group, description: a.description, line: a.line, source: a.source }
  const v = a.value
  if (typeof v === 'boolean') return { ...base, control: { kind: 'toggle' }, annotated: a.annotation !== null }
  if (Array.isArray(v)) {
    const usable = a.annotation !== null && parseAnnotation(a.annotation, 0) !== null
    return { ...base, control: { kind: 'vector', length: v.length }, annotated: usable }
  }
  const parsed = a.annotation === null ? null : parseAnnotation(a.annotation, v)
  if (parsed) return { ...base, control: parsed, annotated: true }
  return { ...base, control: typeof v === 'number' ? { kind: 'number' } : { kind: 'text' }, annotated: false }
}

export function parseCustomizer(code: string): CustomizerParam[] {
  return scanAssignments(code)
    .filter((a) => !a.hidden)
    .map(toParam)
}

function sameType(v: ParamValue, d: ParamValue): boolean {
  if (Array.isArray(d)) return Array.isArray(v) && v.length === d.length && v.every((x) => typeof x === 'number' && Number.isFinite(x))
  if (typeof d === 'number') return typeof v === 'number' && Number.isFinite(v)
  return typeof v === typeof d
}

function bakeLiteral(v: ParamValue): string {
  if (Array.isArray(v)) return `[${v.map(String).join(', ')}]`
  if (typeof v === 'string') return JSON.stringify(v)
  return String(v)
}

/** Rewrites the default values in source ("Bake into code"). */
export function bakeParams(code: string, values: Record<string, ParamValue>): string {
  const edits = scanAssignments(code)
    .filter((a) => !a.hidden && Object.hasOwn(values, a.name) && sameType(values[a.name]!, a.value))
    .sort((x, y) => y.valueStart - x.valueStart)
  let out = code
  for (const a of edits) out = out.slice(0, a.valueStart) + bakeLiteral(values[a.name]!) + out.slice(a.valueEnd)
  return out
}

/** The values to send as `-D` overrides: visible parameters whose value is valid and differs from the default. */
export function paramOverrides(code: string, params: Params): Params {
  const out: Params = {}
  for (const p of parseCustomizer(code)) {
    if (!Object.hasOwn(params, p.name)) continue
    const v = params[p.name]!
    if (sameType(v, p.defaultValue) && !paramValueEqual(v, p.defaultValue)) out[p.name] = v
  }
  return out
}

/** Every visible parameter's current value: the default, or a valid override. */
export function effectiveValues(code: string, params: Params): Params {
  const out: Params = {}
  for (const p of parseCustomizer(code)) {
    const v = Object.hasOwn(params, p.name) ? params[p.name]! : undefined
    out[p.name] = v !== undefined && sameType(v, p.defaultValue) ? v : p.defaultValue
  }
  return out
}
