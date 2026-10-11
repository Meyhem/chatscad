import type { ParamValue } from './types'

export const INPUT_PATH = '/main.scad'
export const OUTPUT_PATH = '/out.stl'

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_]*$/

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Parameter value must be finite, got ${n}`)
  return String(n)
}

export function formatParamValue(value: ParamValue): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(formatNumber).join(',')}]`
  return formatNumber(value)
}

export function buildArgs(params: Record<string, ParamValue> = {}): string[] {
  const args = [INPUT_PATH, '-o', OUTPUT_PATH, '--backend=manifold', '--export-format=binstl']
  for (const [name, value] of Object.entries(params)) {
    if (!IDENTIFIER.test(name)) throw new Error(`Invalid parameter name: ${name}`)
    args.push('-D', `${name}=${formatParamValue(value)}`)
  }
  return args
}
