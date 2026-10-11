// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { tokensToCss, type DesignTokens } from './gen-tokens'

const tokens: DesignTokens = {
  color: {
    themes: [{ id: 'dark' }, { id: 'light' }],
    tokens: [
      { name: 'bg', value: { dark: '#0d1015', light: '#eef1f4' } },
      { name: 'accent', value: { dark: '#6e9bff', light: '#1f4fd1' } },
      { name: 'focus-ring', value: { dark: '{accent}', light: '{accent}' } },
      { name: 'filament', value: '#e9a23b' },
    ],
  },
  type: { families: { sans: '"Archivo", sans-serif', mono: '"JetBrains Mono", monospace' } },
  spacing: { tokens: [{ name: 'space-1', value: '4px' }] },
  radius: { tokens: [{ name: 'radius-sm', value: '3px' }] },
  shadow: { tokens: [{ name: 'shadow-pop', value: { dark: '0 12px 32px rgba(0, 0, 0, 0.55)', light: '0 12px 32px rgba(16, 21, 28, 0.16)' } }] },
  size: { tokens: [{ name: 'control-md', value: '36px' }] },
}

const css = tokensToCss(tokens)
const section = (selector: string) => {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no block for ${selector}`)
  return css.slice(start, css.indexOf('\n}', start))
}

it('puts the primary (dark) theme on :root with every family', () => {
  const root = section(':root')
  expect(root).toContain('color-scheme: dark;')
  expect(root).toContain('--bg: #0d1015;')
  expect(root).toContain('--filament: #e9a23b;')
  expect(root).toContain('--shadow-pop: 0 12px 32px rgba(0, 0, 0, 0.55);')
  expect(root).toContain('--space-1: 4px;')
  expect(root).toContain('--radius-sm: 3px;')
  expect(root).toContain('--control-md: 36px;')
})

it('resolves {alias} values to var() references', () => {
  expect(section(':root')).toContain('--focus-ring: var(--accent);')
})

it('prepends the fontsource variable family name to the sans stack', () => {
  expect(section(':root')).toContain('--font-sans: "Archivo Variable", "Archivo", sans-serif;')
  expect(section(':root')).toContain('--font-mono: "JetBrains Mono", monospace;')
})

it('emits the light theme for data-theme and for the OS preference, inheriting single values', () => {
  const forced = section('[data-theme="light"]')
  expect(forced).toContain('color-scheme: light;')
  expect(forced).toContain('--bg: #eef1f4;')
  expect(forced).toContain('--filament: #e9a23b;')
  expect(css).toContain('@media (prefers-color-scheme: light) {\n  :root:not([data-theme="dark"]) {')
  expect(forced).not.toContain('--space-1') // spacing is not themed
})

it('maps colours, fonts, radii and shadows into the Tailwind theme and drops the default palette', () => {
  expect(css).toContain('@theme {\n  --color-*: initial;\n  --font-*: initial;\n  --shadow-*: initial;\n}')
  const theme = section('@theme inline')
  expect(theme).toContain('--color-bg: var(--bg);')
  expect(theme).toContain('--color-focus-ring: var(--focus-ring);')
  expect(theme).toContain('--font-sans: var(--font-sans);')
  expect(theme).toContain('--radius-sm: var(--radius-sm);')
  expect(theme).toContain('--shadow-pop: var(--shadow-pop);')
  expect(theme).not.toContain('--space-1')
})

it('src/styles/tokens.css is up to date with design/tokens.json (run `npm run tokens`)', async () => {
  const source = JSON.parse(await readFile(new URL('../design/tokens.json', import.meta.url), 'utf8')) as DesignTokens
  const committed = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  expect(committed).toBe(tokensToCss(source))
})
