import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { OpenSCADFactory } from '../render/runOpenSCAD'
import { nodeOpenSCADFactory } from './openscadNode'

const DIR = fileURLToPath(new URL('../../public/openscad/', import.meta.url))

/** True when `npm run fetch:openscad` has installed the pinned build. CI installs it before `npm test`. */
export const REAL_OPENSCAD_AVAILABLE = existsSync(`${DIR}openscad.js`) && existsSync(`${DIR}openscad.wasm`)

let cached: Promise<OpenSCADFactory> | null = null

/** Node-only: the pinned build, handed its WASM bytes so it never fetches; loaded once per test file. */
export function loadRealOpenSCAD(): Promise<OpenSCADFactory> {
  cached ??= nodeOpenSCADFactory()
  return cached
}
