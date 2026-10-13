/** What the reviewer judges a model against; stored per project (spec A4). */
export type CheckKind = 'part' | 'size' | 'fit' | 'feature' | 'print' | 'other'

export interface Check {
  id: string
  kind: CheckKind
  text: string
}

/** A stable empty list for store selectors (a fresh [] would re-render forever). */
export const NO_CHECKS: readonly Check[] = []

export const CHECK_KINDS: readonly CheckKind[] = ['part', 'size', 'fit', 'feature', 'print', 'other']

export const CHECK_KIND_LABEL: Record<CheckKind, string> = {
  part: 'Part',
  size: 'Size',
  fit: 'Fit',
  feature: 'Feature',
  print: 'Print',
  other: 'Other',
}

export const MAX_CHECKS = 20
export const MAX_CHECK_CHARS = 200

export function parseCheckKind(v: unknown): CheckKind {
  const kind = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (CHECK_KINDS as readonly string[]).includes(kind) ? (kind as CheckKind) : 'other'
}

export function newCheck(kind: CheckKind, text: string): Check {
  return { id: crypto.randomUUID(), kind, text: text.trim().slice(0, MAX_CHECK_CHARS) }
}

/** Checks from untrusted data (a model's JSON, an imported file): text only, capped, empty ones dropped. */
export function cleanChecks(raw: unknown): Check[] {
  if (!Array.isArray(raw)) return []
  const out: Check[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (out.length >= MAX_CHECKS) break
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHECK_CHARS) : ''
    if (text === '') continue
    const given = typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 100 ? o.id : null
    const id = given !== null && !seen.has(given) ? given : crypto.randomUUID()
    seen.add(id)
    out.push({ id, kind: parseCheckKind(o.kind), text })
  }
  return out
}
