export interface SearchReplace {
  search: string
  replace: string
}

export type ParsedReply =
  | { kind: 'full'; code: string; prose: string }
  | { kind: 'edits'; edits: SearchReplace[]; prose: string }
  | { kind: 'none'; prose: string }

export type ApplyResult = { ok: true; code: string } | { ok: false; failedIndex: number }

const BLOCK = /^<{7} SEARCH[^\S\n]*\n([\s\S]*?)^={7}[^\S\n]*\n([\s\S]*?)^>{7} REPLACE[^\S\n]*$/gm
const FENCE = /^```[^\S\n]*([\w+-]*)[^\n]*\n([\s\S]*?)^```[^\S\n]*$/gm
const EMPTY_FENCE = /^```[\w+-]*[^\S\n]*\n\s*^```[^\S\n]*$/gm

const lf = (s: string) => s.replace(/\r\n?/g, '\n')
const chomp = (s: string) => (s.endsWith('\n') ? s.slice(0, -1) : s)

function cleanProse(text: string): string {
  return text.replace(EMPTY_FENCE, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function parseReply(text: string): ParsedReply {
  const src = lf(text)

  const edits: SearchReplace[] = []
  const withoutBlocks = src.replace(BLOCK, (_match, search: string, replace: string) => {
    edits.push({ search: chomp(search), replace: chomp(replace) })
    return ''
  })
  if (edits.length > 0) return { kind: 'edits', edits, prose: cleanProse(withoutBlocks) }

  const fences = [...src.matchAll(FENCE)].filter((f) => f[2].trim() !== '')
  const scad = fences.filter((f) => /^(openscad|scad)$/i.test(f[1]))
  const candidates = scad.length > 0 ? scad : fences.filter((f) => f[1] === '')
  const chosen = candidates.at(-1)
  if (!chosen) return { kind: 'none', prose: cleanProse(src) }

  let prose = src
  for (const f of candidates) prose = prose.replace(f[0], () => '')
  return { kind: 'full', code: chosen[2], prose: cleanProse(prose) }
}

/** Each search must match exactly once (after normalising CRLF); edits apply in order. */
export function applyEdits(code: string, edits: SearchReplace[]): ApplyResult {
  let out = lf(code)
  for (const [i, edit] of edits.entries()) {
    const search = lf(edit.search)
    if (search === '') return { ok: false, failedIndex: i }
    const at = out.indexOf(search)
    if (at < 0 || out.indexOf(search, at + 1) >= 0) return { ok: false, failedIndex: i }
    out = out.slice(0, at) + lf(edit.replace) + out.slice(at + search.length)
  }
  return { ok: true, code: out }
}
