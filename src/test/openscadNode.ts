import { readFile } from 'node:fs/promises'
import type { LibraryBundle, LibraryName } from '../render/libraries'
import type { OpenSCADFactory, OpenSCADFactoryOptions, OpenSCADInstance } from '../render/runOpenSCAD'

const PUBLIC = new URL('../../public/', import.meta.url)

type RealFactory = (opts: OpenSCADFactoryOptions) => Promise<OpenSCADInstance>

/** The pinned OpenSCAD WASM from public/openscad/, run in Node. The web build runs there when it is handed the binary. */
export async function nodeOpenSCADFactory(): Promise<OpenSCADFactory> {
  let wasmBinary: ArrayBuffer
  try {
    const bytes = await readFile(new URL('openscad/openscad.wasm', PUBLIC))
    wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  } catch {
    throw new Error('public/openscad/openscad.wasm is missing; run `npm run fetch:openscad`')
  }
  const mod = (await import(/* @vite-ignore */ new URL('openscad/openscad.js', PUBLIC).href)) as { default: RealFactory }
  return (opts) => mod.default({ ...opts, wasmBinary })
}

export async function loadLibraryFromDisk(name: LibraryName): Promise<LibraryBundle> {
  try {
    return JSON.parse(await readFile(new URL(`libraries/${name}.json`, PUBLIC), 'utf8')) as LibraryBundle
  } catch {
    throw new Error(`public/libraries/${name}.json is missing; run \`npm run fetch:libraries\``)
  }
}
