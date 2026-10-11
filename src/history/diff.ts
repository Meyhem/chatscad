import { diffLines } from 'diff'

export interface DiffCell {
  line: number
  text: string
  kind: 'same' | 'add' | 'del'
}

export type DiffRow = { kind: 'pair'; left: DiffCell | null; right: DiffCell | null } | { kind: 'skip'; count: number }

export interface SideBySide {
  rows: DiffRow[]
  added: number
  removed: number
}

const OPTIONS = { ignoreNewlineAtEof: true }

function splitLines(value: string): string[] {
  const out = value.split('\n')
  if (out.at(-1) === '') out.pop()
  return out
}

export function countLineChanges(oldCode: string, newCode: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const c of diffLines(oldCode, newCode, OPTIONS)) {
    if (c.added) added += splitLines(c.value).length
    else if (c.removed) removed += splitLines(c.value).length
  }
  return { added, removed }
}

type Pair = { left: DiffCell | null; right: DiffCell | null }

export function sideBySide(oldCode: string, newCode: string, context = 3): SideBySide {
  const changes = diffLines(oldCode, newCode, OPTIONS)
  const pairs: Pair[] = []
  let l = 1
  let r = 1
  let added = 0
  let removed = 0

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]!
    const text = splitLines(c.value)
    if (c.removed) {
      const next = changes[i + 1]
      const addedText = next?.added ? splitLines(next.value) : []
      if (next?.added) i++
      const n = Math.max(text.length, addedText.length)
      for (let k = 0; k < n; k++) {
        pairs.push({
          left: k < text.length ? { line: l++, text: text[k]!, kind: 'del' } : null,
          right: k < addedText.length ? { line: r++, text: addedText[k]!, kind: 'add' } : null,
        })
      }
      removed += text.length
      added += addedText.length
    } else if (c.added) {
      for (const t of text) pairs.push({ left: null, right: { line: r++, text: t, kind: 'add' } })
      added += text.length
    } else {
      for (const t of text) pairs.push({ left: { line: l++, text: t, kind: 'same' }, right: { line: r++, text: t, kind: 'same' } })
    }
  }

  const rows: DiffRow[] = []
  const same = (p: Pair) => p.left?.kind === 'same'
  let i = 0
  while (i < pairs.length) {
    if (!same(pairs[i]!)) {
      rows.push({ kind: 'pair', ...pairs[i]! })
      i++
      continue
    }
    let j = i
    while (j < pairs.length && same(pairs[j]!)) j++
    const before = i === 0 ? 0 : context
    const after = j === pairs.length ? 0 : context
    if (j - i > before + after + 1) {
      for (let k = i; k < i + before; k++) rows.push({ kind: 'pair', ...pairs[k]! })
      rows.push({ kind: 'skip', count: j - i - before - after })
      for (let k = j - after; k < j; k++) rows.push({ kind: 'pair', ...pairs[k]! })
    } else {
      for (let k = i; k < j; k++) rows.push({ kind: 'pair', ...pairs[k]! })
    }
    i = j
  }
  return { rows, added, removed }
}
