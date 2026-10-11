import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ThemedValue = Record<string, string>
export interface TokenEntry {
  name: string
  value: string | ThemedValue
  usage?: string
}
interface TokenFamily {
  tokens: TokenEntry[]
}
export interface DesignTokens {
  color: { themes: { id: string; name?: string }[]; tokens: TokenEntry[] }
  type: { families: Record<string, string> }
  spacing?: TokenFamily
  radius?: TokenFamily
  shadow?: TokenFamily
  size?: TokenFamily
}

const TOKENS_PATH = fileURLToPath(new URL('../design/tokens.json', import.meta.url))
const OUT_PATH = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url))

/** fontsource ships Archivo as a variable font registered under this family name. */
const FONT_PREPEND: Record<string, string> = { sans: '"Archivo Variable"' }

const cssValue = (v: string) => v.replace(/\{([A-Za-z0-9_.-]+)\}/g, 'var(--$1)')

function pick(value: string | ThemedValue, theme: string, primary: string): string {
  if (typeof value === 'string') return value
  const v = value[theme] ?? value[primary]
  if (v === undefined) throw new Error(`Token has no value for theme "${theme}" or "${primary}"`)
  return v
}

function block(selector: string, lines: string[], indent = ''): string {
  return `${indent}${selector} {\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`
}

export function tokensToCss(t: DesignTokens): string {
  const [primary, ...others] = t.color.themes.map((th) => th.id)
  if (!primary) throw new Error('tokens.json declares no colour themes')
  const themedFamilies = [t.color, t.shadow].flatMap((f) => f?.tokens ?? [])
  const unthemedFamilies = [t.spacing, t.radius, t.size].flatMap((f) => f?.tokens ?? [])

  const themed = (theme: string) => [
    `color-scheme: ${theme};`,
    ...themedFamilies.map((tok) => `--${tok.name}: ${cssValue(pick(tok.value, theme, primary))};`),
  ]
  const unthemed = [
    ...Object.entries(t.type.families).map(
      ([k, stack]) => `--font-${k}: ${[FONT_PREPEND[k], stack].filter(Boolean).join(', ')};`,
    ),
    ...unthemedFamilies.map((tok) => `--${tok.name}: ${cssValue(pick(tok.value, primary, primary))};`),
  ]
  const tailwind = [
    ...t.color.tokens.map((tok) => `--color-${tok.name}: var(--${tok.name});`),
    ...Object.keys(t.type.families).map((k) => `--font-${k}: var(--font-${k});`),
    ...(t.radius?.tokens ?? []).map((tok) => `--${tok.name}: var(--${tok.name});`),
    ...(t.shadow?.tokens ?? []).map((tok) => `--${tok.name}: var(--${tok.name});`),
  ]

  return [
    '/* Generated from design/tokens.json by scripts/gen-tokens.ts. Do not edit; run `npm run tokens`. */',
    block(':root', [...themed(primary), ...unthemed]),
    ...others.flatMap((id) => [
      block(`[data-theme="${id}"]`, themed(id)),
      `@media (prefers-color-scheme: ${id}) {\n${block(`:root:not([data-theme="${primary}"])`, themed(id), '  ')}\n}`,
    ]),
    block('@theme', ['--color-*: initial;', '--font-*: initial;', '--shadow-*: initial;']),
    block('@theme inline', tailwind),
  ].join('\n\n') + '\n'
}

async function main(): Promise<void> {
  const tokens = JSON.parse(await readFile(TOKENS_PATH, 'utf8')) as DesignTokens
  await writeFile(OUT_PATH, tokensToCss(tokens))
  console.log(`Wrote ${OUT_PATH}`)
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
