import type { StatementRange } from './statements'

/** 24-bit colours, minus 0 (untagged) and white. */
export const MAX_TAG = 16_777_214

export function encodeTag(tag: number): [number, number, number] {
  if (!Number.isInteger(tag) || tag < 1 || tag > MAX_TAG) throw new RangeError(`Tag ${tag} is outside 1–${MAX_TAG}`)
  return [(tag >> 16) & 255, (tag >> 8) & 255, tag & 255]
}

const channel = (v: number) => Math.min(255, Math.max(0, Math.round(v)))

export function decodeTag(r: number, g: number, b: number, maxTag: number): number {
  const packed = (channel(r) << 16) | (channel(g) << 8) | channel(b)
  return packed >= 1 && packed <= maxTag ? packed : 0
}

export function tagColor(tag: number): string {
  const [r, g, b] = encodeTag(tag)
  return `color([${r} / 255, ${g} / 255, ${b} / 255])`
}

/** Preview-only: the editor code is never changed. Insertions never add a newline, so line numbers stay put. */
export function tagCode(code: string, statements: readonly StatementRange[]): string {
  let out = code
  for (const s of [...statements].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, s.start)}${tagColor(s.tag)} ${out.slice(s.start)}`
  }
  return out
}
