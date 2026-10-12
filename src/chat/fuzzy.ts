const isWordStart = (text: string, i: number) => i === 0 || !/[a-z0-9]/.test(text[i - 1])

// Score one lower-case word against lower-case text, or null if its characters
// do not appear in order. A contiguous match always outranks a scattered one.
function wordScore(word: string, text: string): number | null {
  const at = text.indexOf(word)
  if (at !== -1) return 1000 + (isWordStart(text, at) ? 100 : 0) - at
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

/** Higher is better; null means no match. Every space-separated word of the query must match. */
export function fuzzyScore(query: string, text: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const target = text.toLowerCase()
  let total = 0
  for (const w of words) {
    const s = wordScore(w, target)
    if (s === null) return null
    total += s
  }
  return total
}

/** The items that match the query, best first; ties keep their original order. */
export function fuzzyFilter(query: string, items: string[]): string[] {
  if (query.trim() === '') return items
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, item) }))
    .filter((r): r is { item: string; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item)
}
