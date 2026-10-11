import { paramValueEqual, type Params } from '../render/params'
import type { ParamValue } from '../render/types'
import { countLineChanges } from './diff'

/** First line only, cut at `max` characters with an ellipsis. */
export function truncate(text: string, max = 120): string {
  const first = text.trim().split('\n')[0]!.trim()
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

export function formatValue(v: ParamValue): string {
  return Array.isArray(v) ? `[${v.join(', ')}]` : String(v)
}

/** "height 18 → 22" from the effective values before and after. */
export function describeParamChanges(before: Params, after: Params): string {
  const parts = Object.keys(after)
    .filter((k) => !Object.hasOwn(before, k) || !paramValueEqual(before[k]!, after[k]!))
    .map((k) => (Object.hasOwn(before, k) ? `${k} ${formatValue(before[k]!)} → ${formatValue(after[k]!)}` : `${k} ${formatValue(after[k]!)}`))
  if (parts.length === 0) return 'Parameters unchanged'
  return parts.length > 3 ? `${parts.slice(0, 3).join(', ')} and ${parts.length - 3} more` : parts.join(', ')
}

export function manualMessage(oldCode: string, newCode: string): string {
  const { added, removed } = countLineChanges(oldCode, newCode)
  return `Edited code · +${added} −${removed} lines`
}

export function bakeMessage(names: string[]): string {
  return names.length > 0 ? `Baked ${names.join(', ')} into code` : 'Baked parameters into code'
}
