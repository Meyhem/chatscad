import * as Comlink from 'comlink'
import { fetchWithProgress } from './fetchWithProgress'
import { loadProgressMessage, throttleProgress } from './loadProgress'
import { libraryUrl, type LibraryBundle, type LibraryName } from './libraries'
import { runOpenSCAD, type OpenSCADFactory, type OpenSCADFactoryOptions } from './runOpenSCAD'
import type { RenderRequest, RenderResult } from './types'

const BASE = import.meta.env.BASE_URL
const OPENSCAD_DIR = `${BASE}openscad/`

/** A worker's postMessage takes one argument; the DOM lib types the global as Window's. */
const post = (message: unknown) => (globalThis as unknown as { postMessage(m: unknown): void }).postMessage(message)

let factoryPromise: Promise<OpenSCADFactory> | null = null

function loadFactory(): Promise<OpenSCADFactory> {
  factoryPromise ??= Promise.all([
    import(/* @vite-ignore */ `${OPENSCAD_DIR}openscad.js`) as Promise<{
      default: (opts: OpenSCADFactoryOptions) => ReturnType<OpenSCADFactory>
    }>,
    // Fetched here rather than by Emscripten so the page can show download progress; reused by every fresh instance.
    fetchWithProgress(`${OPENSCAD_DIR}openscad.wasm`, throttleProgress((p) => post(loadProgressMessage(p)))),
  ])
    .then(([mod, wasmBinary]) => {
      const create = mod.default
      return (opts: OpenSCADFactoryOptions) => create({ ...opts, locateFile: (path) => OPENSCAD_DIR + path, wasmBinary })
    })
    .catch((e: unknown) => {
      factoryPromise = null
      throw e
    })
  return factoryPromise
}

// One fetch per library per worker; a timeout respawns the worker and starts a fresh cache.
const libraryCache = new Map<LibraryName, Promise<LibraryBundle>>()

function loadLibrary(name: LibraryName): Promise<LibraryBundle> {
  const cached = libraryCache.get(name)
  if (cached) return cached
  const p = fetch(libraryUrl(BASE, name)).then(async (res) => {
    if (!res.ok) throw new Error(`GET ${res.url} failed with ${res.status}`)
    return (await res.json()) as LibraryBundle
  })
  libraryCache.set(name, p)
  p.catch(() => libraryCache.delete(name))
  return p
}

const api = {
  async render(req: RenderRequest): Promise<RenderResult> {
    const result = await runOpenSCAD(await loadFactory(), req, loadLibrary)
    if (!result.ok) return result
    const transfer: Transferable[] = [result.mesh.positions.buffer, result.mesh.normals.buffer, result.stl]
    if (result.mesh.faceTags) transfer.push(result.mesh.faceTags.buffer)
    return Comlink.transfer(result, transfer)
  },
}

export type RenderWorkerApi = typeof api

Comlink.expose(api)
