// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const HEX = /#[0-9a-fA-F]{3,8}\b/
const PALETTE =
  /\b(?:bg|text|border|fill|stroke|ring|outline|from|via|to|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])),
  )
  return files.flat()
}

it('src uses design tokens: no hex literals, no Tailwind palette classes', async () => {
  const offenders: string[] = []
  for (const file of await walk(SRC)) {
    if (!/\.(tsx?|css)$/.test(file) || /\.test\.tsx?$/.test(file) || file.endsWith('styles/tokens.css')) continue
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (HEX.test(line) || PALETTE.test(line)) offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`)
    })
  }
  expect(offenders).toEqual([])
})
