import * as Comlink from 'comlink'
import { runOpenSCAD, type OpenSCADFactory, type OpenSCADFactoryOptions } from './runOpenSCAD'
import type { RenderRequest, RenderResult } from './types'

const OPENSCAD_DIR = `${import.meta.env.BASE_URL}openscad/`

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

const api = {
  async render(req: RenderRequest): Promise<RenderResult> {
    const result = await runOpenSCAD(await loadFactory(), req)
    if (!result.ok) return result
    return Comlink.transfer(result, [result.mesh.positions.buffer, result.mesh.normals.buffer, result.stl])
  },
}

export type RenderWorkerApi = typeof api

Comlink.expose(api)
