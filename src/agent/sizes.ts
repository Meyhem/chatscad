import { unitFor } from '../customizer/units'
import type { ParamValue } from '../render/types'
import { effectiveValues, parseCustomizer, type ParamSource } from '../scad/customizer'

export interface SizeRow {
  name: string
  value: ParamValue
  unit: string
  source: ParamSource
}

const ORDER: Record<string, number> = { guess: 0, photo: 1, description: 2, none: 3 }

/** Every top-level parameter with its current value and source; guesses first, so the user checks them first (spec P8). */
export function sizeRows(code: string, params: Record<string, ParamValue>): SizeRow[] {
  const values = effectiveValues(code, params)
  return parseCustomizer(code)
    .map((p) => ({ name: p.name, value: values[p.name] ?? p.defaultValue, unit: typeof p.defaultValue === 'number' ? unitFor(p) : '', source: p.source }))
    .sort((a, b) => ORDER[a.source ?? 'none']! - ORDER[b.source ?? 'none']!)
}

export function sizesSummary(rows: SizeRow[], versionLabel: string | null): string {
  const head = versionLabel ? `Sizes in ${versionLabel}` : 'Sizes'
  const guessed = rows.filter((r) => r.source === 'guess').length
  const given = rows.some((r) => r.source !== null)
  return `${head} · ${rows.length} · ${given ? `${guessed} guessed` : 'source not given'}`
}
