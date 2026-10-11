import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const SNAPSHOTS_URL = 'https://files.openscad.org/snapshots/'
const OUT_DIR = fileURLToPath(new URL('../public/openscad/', import.meta.url))
const REQUIRED = ['openscad.js', 'openscad.wasm'] as const

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
  const ifMissing = process.argv.includes('--if-missing')
  if (ifMissing && (await Promise.all(REQUIRED.map((f) => exists(OUT_DIR + f)))).every(Boolean)) {
    console.log('OpenSCAD WASM already present in public/openscad/')
    return
  }

  let url = process.env.OPENSCAD_WASM_URL
  if (!url) {
    const name = pickLatestWasmZip(await (await fetchOk(SNAPSHOTS_URL)).text())
    if (!name) throw new Error(`No *-WebAssembly-web.zip found at ${SNAPSHOTS_URL}; set OPENSCAD_WASM_URL`)
    url = SNAPSHOTS_URL + name
  }

  console.log(`Downloading ${url}`)
  const files = unzipSync(new Uint8Array(await (await fetchOk(url)).arrayBuffer()))
  await mkdir(OUT_DIR, { recursive: true })
  for (const wanted of REQUIRED) {
    const entry = Object.keys(files).find((path) => path.split('/').pop() === wanted)
    if (!entry) throw new Error(`${wanted} not found in zip. Entries: ${Object.keys(files).join(', ')}`)
    await writeFile(OUT_DIR + wanted, files[entry]!)
  }
  await writeFile(OUT_DIR + 'VERSION', `${url}\n`)
  console.log(`OpenSCAD WASM written to ${OUT_DIR}`)
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
