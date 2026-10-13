// @vitest-environment node
import { readFileSync } from 'node:fs'

const SHEET_TOKENS = ['sheet-paper', 'sheet-ink', 'sheet-muted']

function findToken(node: unknown, name: string): { value: unknown } | undefined {
  if (Array.isArray(node)) return node.map((n) => findToken(n, name)).find(Boolean)
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (o.name === name && 'value' in o) return o as { value: unknown }
    return Object.values(o)
      .map((n) => findToken(n, name))
      .find(Boolean)
  }
  return undefined
}

it('keeps the drawing colours fixed in both themes, so the sheet prints the same in dark mode', () => {
  const json: unknown = JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8'))
  const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
  for (const name of SHEET_TOKENS) {
    expect(typeof findToken(json, name)?.value).toBe('string') // one value, not { dark, light }
    expect(css).toContain(`--${name}:`)
  }
})
