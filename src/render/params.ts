import type { ParamValue } from './types'

export type Params = Record<string, ParamValue>

export function paramValueEqual(a: ParamValue, b: ParamValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
  }
  return a === b
}

export function paramsEqual(a: Params | null | undefined, b: Params | null | undefined): boolean {
  const x = a ?? {}
  const y = b ?? {}
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => k in y && paramValueEqual(x[k]!, y[k]!))
}
