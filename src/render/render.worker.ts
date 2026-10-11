import * as Comlink from 'comlink'
import { libraryUrl, type LibraryBundle, type LibraryName } from './libraries'
import { runOpenSCAD, type OpenSCADFactory, type OpenSCADFactoryOptions } from './runOpenSCAD'
import type { RenderRequest, RenderResult } from './types'

const BASE = import.meta.env.BASE_URL
const OPENSCAD_DIR = `${BASE}openscad/`

let factoryPromise: Promise<OpenSCADFactory> | null = null

function loadFactory(): Promise<OpenSCADFactory> {
  factoryPromise ??= import(/* @vite-ignore */ `${OPENSCAD_DIR}openscad.js`)
    .then((mod: { default: (opts: OpenSCADFactoryOptions) => ReturnType<OpenSCADFactory> }) => {
      const create = mod.default
      return (opts: OpenSCADFactoryOptions) => create({ ...opts, locateFile: (path) => OPENSCAD_DIR + path })
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
    return Comlink.transfer(result, [result.mesh.positions.buffer, result.mesh.normals.buffer, result.stl])
  },
}

export type RenderWorkerApi = typeof api

Comlink.expose(api)
