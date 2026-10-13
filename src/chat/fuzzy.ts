/** Lower-case words of letters and digits in any script; accents, case and punctuation never matter. */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Optimal string alignment distance: insertions, deletions, substitutions and swaps of two neighbours. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

const isWordStart = (text: string, i: number) => i === 0 || text[i - 1] === ' '
const isWordEnd = (text: string, i: number) => i === text.length || text[i] === ' '

/** Edits a word of this length may contain and still match. */
const allowedTypos = (length: number) => (length >= 8 ? 2 : length >= 5 ? 1 : 0)
const TYPO_PENALTY = -100

// The best contiguous occurrence: whole words, then word starts, then earlier positions.
function contiguousScore(word: string, text: string): number | null {
  let best: number | null = null
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    const start = isWordStart(text, at)
    const s = 1000 + (start ? 100 : 0) + (start && isWordEnd(text, at + word.length) ? 50 : 0) - at
    if (best === null || s > best) best = s
  }
  return best
}

// The word's characters in order with gaps, or null.
function scatteredScore(word: string, text: string): number | null {
  let score = 0
  let prev = -1
  for (const ch of word) {
    const i = text.indexOf(ch, prev + 1)
    if (i === -1) return null
    if (isWordStart(text, i)) score += 10
    if (i === prev + 1) score += 5
    else if (prev !== -1) score -= i - prev - 1
    prev = i
  }
  return score
}

// A word within a few edits of a target word, or of that word's start.
function typoScore(word: string, text: string): number | null {
  const allowed = allowedTypos(word.length)
  if (allowed === 0) return null
  let best = Infinity
  for (const token of text.split(' ')) {
    best = Math.min(best, editDistance(word, token), editDistance(word, token.slice(0, word.length)))
  }
  return best <= allowed ? TYPO_PENALTY * best : null
}

// Score one normalised query word against one normalised text. A contiguous match always outranks a scattered one, which outranks a typo.
function wordScore(word: string, text: string): number | null {
  return contiguousScore(word, text) ?? scatteredScore(word, text) ?? typoScore(word, text)
}

/** Higher is better; null means no match. Every word of the query must match one of `texts`; each word takes its best text. */
export function fuzzyScore(query: string, texts: string | readonly string[]): number | null {
  const words = normalise(query).split(' ').filter(Boolean)
  const targets = (typeof texts === 'string' ? [texts] : texts).map(normalise).filter(Boolean)
  let total = 0
  for (const w of words) {
    let best: number | null = null
    for (const t of targets) {
      const s = wordScore(w, t)
      if (s !== null && (best === null || s > best)) best = s
    }
    if (best === null) return null
    total += best
  }
  return total
}

/** The items that match the query, best first; ties keep their original order. `keys` gives the texts to search per item. */
export function fuzzyFilter<T = string>(query: string, items: readonly T[], keys: (item: T) => readonly string[] = (item) => [String(item)]): T[] {
  if (normalise(query) === '') return [...items]
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, keys(item)) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item)
}
