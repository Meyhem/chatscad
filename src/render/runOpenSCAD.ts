import { buildArgs, INPUT_PATH, OUTPUT_PATH } from './args'
import { parseDiagnostics } from './diagnostics'
import { isLibraryName, LIBRARY_NAMES, LIBRARY_ROOT, writeLibraries, type LibraryBundle, type LibraryName } from './libraries'
import { errorMessage, failedResult } from './result'
import { parseStl } from './stl'
import type { LogLine, MeshData, RenderRequest, RenderResult } from './types'

export interface OpenSCADInstance {
  FS: {
    writeFile(path: string, data: string | Uint8Array): void
    readFile(path: string): Uint8Array
    mkdirTree(path: string): void
  }
  /** Emscripten's environment; read by OpenSCAD when callMain starts. */
  ENV: Record<string, string | undefined>
  callMain(args: string[]): number
}

export interface OpenSCADFactoryOptions {
  noInitialRun: true
  print(text: string): void
  printErr(text: string): void
  locateFile?(path: string): string
  /** Pre-fetched openscad.wasm; Emscripten instantiates it instead of fetching the file itself. */
  wasmBinary?: ArrayBuffer
}

export type OpenSCADFactory = (opts: OpenSCADFactoryOptions) => Promise<OpenSCADInstance>

/** OpenSCAD reports these without an ERROR: prefix and exits 1 before writing any output. */
const NO_GEOMETRY: [RegExp, string][] = [
  [/Current top level object is empty/, 'The model produced no 3D geometry'],
  [/Current top level object is not a 3D object/, 'The model is 2D only; STL needs a 3D object'],
]

function explainExit(logs: LogLine[], exitCode: number): string {
  for (const [pattern, message] of NO_GEOMETRY) if (logs.some((l) => pattern.test(l.text))) return message
  return `OpenSCAD exited with code ${exitCode}`
}

function isExitStatus(e: unknown): e is { status: number } {
  return typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number'
}

export type LibraryLoader = (name: LibraryName) => Promise<LibraryBundle>

async function loadLibraries(names: string[], load: LibraryLoader | undefined): Promise<LibraryBundle[]> {
  const bundles: LibraryBundle[] = []
  for (const name of names) {
    if (!isLibraryName(name)) throw new Error(`Unknown library "${name}"; available: ${LIBRARY_NAMES.join(', ')}`)
    if (!load) throw new Error(`The ${name} library is not available in this build`)
    try {
      bundles.push(await load(name))
    } catch (e) {
      throw new Error(`Couldn't load the ${name} library: ${errorMessage(e)}`)
    }
  }
  return bundles
}

export async function runOpenSCAD(factory: OpenSCADFactory, req: RenderRequest, loadLibrary?: LibraryLoader): Promise<RenderResult> {
  const startedAt = performance.now()
  const logs: LogLine[] = []
  const fail = (error: string) => failedResult(error, { logs, renderMs: performance.now() - startedAt })

  let args: string[]
  try {
    args = buildArgs(req.params)
  } catch (e) {
    return fail(errorMessage(e))
  }

  let bundles: LibraryBundle[]
  try {
    bundles = await loadLibraries(req.libraries ?? [], loadLibrary)
  } catch (e) {
    return fail(errorMessage(e))
  }

  let instance: OpenSCADInstance
  try {
    instance = await factory({
      noInitialRun: true,
      print: (text) => logs.push({ stream: 'stdout', text }),
      printErr: (text) => logs.push({ stream: 'stderr', text }),
    })
  } catch (e) {
    return fail(`Failed to load OpenSCAD: ${errorMessage(e)}`)
  }

  instance.FS.writeFile(INPUT_PATH, req.code)
  if (bundles.length > 0) {
    writeLibraries(instance.FS, bundles)
    instance.ENV.OPENSCADPATH = LIBRARY_ROOT
  }

  let exitCode: number
  try {
    exitCode = instance.callMain(args)
  } catch (e) {
    if (!isExitStatus(e)) return fail(`OpenSCAD crashed: ${errorMessage(e)}`)
    exitCode = e.status
  }
  if (exitCode !== 0) return fail(explainExit(logs, exitCode))

  let bytes: Uint8Array
  try {
    bytes = instance.FS.readFile(OUTPUT_PATH)
  } catch {
    return fail('OpenSCAD produced no output (is the model empty?)')
  }

  const stl = new Uint8Array(bytes).buffer
  let mesh: MeshData
  try {
    mesh = parseStl(stl)
  } catch (e) {
    return fail(errorMessage(e))
  }
  if (mesh.triangleCount === 0) return fail('Model is empty')

  return { ok: true, mesh, stl, logs, diagnostics: parseDiagnostics(logs), renderMs: performance.now() - startedAt }
}
