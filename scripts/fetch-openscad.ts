import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const SNAPSHOTS_URL = 'https://files.openscad.org/snapshots/'
const OUT_DIR = fileURLToPath(new URL('../public/openscad/', import.meta.url))
const REQUIRED = ['openscad.js', 'openscad.wasm'] as const

export interface WasmSource {
  url: string
  sha256: string
}

/**
 * The OpenSCAD runtime executes as first-party script under the app's CSP, so the build only accepts a
 * known snapshot. To upgrade: run `npm run fetch:openscad -- --latest`, review, and paste the printed values here.
 */
export const PINNED: WasmSource = {
  url: 'https://files.openscad.org/snapshots/OpenSCAD-2026.10.08-WebAssembly-web.zip',
  sha256: '274c0e725733efea09e99b1186ebafe50ce799b8c8353ad59d9e72a6b9c76ab1',
}

export function resolveSource(env: Record<string, string | undefined>): WasmSource {
  const url = env.OPENSCAD_WASM_URL
  if (!url) return PINNED
  const sha256 = env.OPENSCAD_WASM_SHA256?.toLowerCase()
  if (!sha256) throw new Error('OPENSCAD_WASM_URL needs OPENSCAD_WASM_SHA256 (the zip\'s SHA-256) so the download can be verified')
  return { url, sha256 }
}

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export function verifySha256(bytes: Uint8Array, expected: string): void {
  const actual = sha256Hex(bytes)
  if (actual !== expected) throw new Error(`OpenSCAD download failed verification: expected ${expected}, got ${actual}`)
}

export function pickLatestWasmZip(html: string): string | null {
  const matches = html.matchAll(/OpenSCAD-\d{4}\.\d{2}\.\d{2}[^"'<>\s]*?-WebAssembly-web\.zip/g)
  const names = [...new Set([...matches].map((m) => m[0]))]
  names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  return names.at(-1) ?? null
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  return res
}

async function main(): Promise<void> {
  if (process.argv.includes('--latest')) {
    const name = pickLatestWasmZip(await (await fetchOk(SNAPSHOTS_URL)).text())
    if (!name) throw new Error(`No *-WebAssembly-web.zip found at ${SNAPSHOTS_URL}`)
    const bytes = new Uint8Array(await (await fetchOk(SNAPSHOTS_URL + name)).arrayBuffer())
    console.log(`Newest snapshot (not installed). To pin it, set PINNED in scripts/fetch-openscad.ts to:\n  url: '${SNAPSHOTS_URL + name}'\n  sha256: '${sha256Hex(bytes)}'`)
    return
  }

  const source = resolveSource(process.env)
  const ifMissing = process.argv.includes('--if-missing')
  if (ifMissing && (await Promise.all(REQUIRED.map((f) => exists(OUT_DIR + f)))).every(Boolean)) {
    const installed = await readFile(OUT_DIR + 'VERSION', 'utf8').catch(() => '')
    if (installed.split('\n')[0] === source.url) {
      console.log('OpenSCAD WASM already present in public/openscad/')
      return
    }
  }

  console.log(`Downloading ${source.url}`)
  const zip = new Uint8Array(await (await fetchOk(source.url)).arrayBuffer())
  verifySha256(zip, source.sha256)
  const files = unzipSync(zip)
  await mkdir(OUT_DIR, { recursive: true })
  for (const wanted of REQUIRED) {
    const entry = Object.keys(files).find((path) => path.split('/').pop() === wanted)
    if (!entry) throw new Error(`${wanted} not found in zip. Entries: ${Object.keys(files).join(', ')}`)
    await writeFile(OUT_DIR + wanted, files[entry]!)
  }
  await writeFile(OUT_DIR + 'VERSION', `${source.url}\nsha256 ${source.sha256}\n`)
  console.log(`OpenSCAD WASM written to ${OUT_DIR}`)
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
