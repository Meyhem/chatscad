import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { LIBRARY_INFO, LIBRARY_NAMES, type LibraryBundle, type LibraryName } from '../src/render/libraries'

const OUT_DIR = fileURLToPath(new URL('../public/libraries/', import.meta.url))

/**
 * Library code runs inside every render that enables it, so the build only accepts known archives.
 * To bump: pick the new ref, run `curl -sL <url> | sha256sum`, review the archive, update both values here
 * and LIBRARY_INFO[name].version in src/render/libraries.ts.
 */
export const LIBRARY_SOURCES: Record<LibraryName, { url: string; sha256: string }> = {
  BOSL2: {
    url: 'https://github.com/BelfrySCAD/BOSL2/archive/refs/tags/v2.0.766.zip',
    sha256: '92a9904a76021b0162976cfd8f2ae2188e792fc718762535c3c30174e61cbb97',
  },
  MCAD: {
    url: 'https://github.com/openscad/MCAD/archive/bd0a7ba3f042bfbced5ca1894b236cea08904e26.zip',
    sha256: 'bd40207753bb5111ac2022da47bdd0cba91393018badebc8541b8cb1d9f8572a',
  },
}

const SKIP_DIRS = new Set(['tests', 'examples', 'tutorials', 'scripts', 'images', 'resources', '.github'])
const LICENCE = /^(LICENSE|COPYING|lgpl[\w.-]*)(\.(txt|md))?$/i

export function verifyDownload(bytes: Uint8Array, expected: string, what: string): void {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`${what} download failed verification: expected ${expected}, got ${actual}`)
}

export function bundleFromZip(name: LibraryName, version: string, source: string, entries: Record<string, Uint8Array>): LibraryBundle {
  const decoder = new TextDecoder()
  const files: Record<string, string> = {}
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    const rel = path.split('/').slice(1).join('/')
    if (!rel || SKIP_DIRS.has(rel.split('/')[0]!)) continue
    const isLicence = !rel.includes('/') && LICENCE.test(rel)
    if (!rel.endsWith('.scad') && !isLicence) continue
    files[rel] = decoder.decode(data)
  }
  if (!Object.keys(files).some((f) => f.endsWith('.scad'))) throw new Error(`${name}: the archive has no .scad files`)
  return { name, version, source, files }
}

async function installed(name: LibraryName): Promise<string | null> {
  try {
    return (JSON.parse(await readFile(`${OUT_DIR}${name}.json`, 'utf8')) as LibraryBundle).source
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const ifMissing = process.argv.includes('--if-missing')
  await mkdir(OUT_DIR, { recursive: true })
  for (const name of LIBRARY_NAMES) {
    const { url, sha256 } = LIBRARY_SOURCES[name]
    if (ifMissing && (await installed(name)) === url) {
      console.log(`${name} already present in public/libraries/`)
      continue
    }
    console.log(`Downloading ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
    const zip = new Uint8Array(await res.arrayBuffer())
    verifyDownload(zip, sha256, name)
    const bundle = bundleFromZip(name, LIBRARY_INFO[name].version, url, unzipSync(zip))
    await writeFile(`${OUT_DIR}${name}.json`, JSON.stringify(bundle))
    console.log(`${name}: ${Object.keys(bundle.files).length} files written to public/libraries/${name}.json`)
  }
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
