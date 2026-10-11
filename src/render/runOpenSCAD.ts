import { buildArgs, INPUT_PATH, OUTPUT_PATH } from './args'
import { parseDiagnostics } from './diagnostics'
import { errorMessage, failedResult } from './result'
import { parseStl } from './stl'
import type { LogLine, MeshData, RenderRequest, RenderResult } from './types'

export interface OpenSCADInstance {
  FS: {
    writeFile(path: string, data: string | Uint8Array): void
    readFile(path: string): Uint8Array
  }
  callMain(args: string[]): number
}

export interface OpenSCADFactoryOptions {
  noInitialRun: true
  print(text: string): void
  printErr(text: string): void
  locateFile?(path: string): string
}

export type OpenSCADFactory = (opts: OpenSCADFactoryOptions) => Promise<OpenSCADInstance>

function isExitStatus(e: unknown): e is { status: number } {
  return typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number'
}

export async function runOpenSCAD(factory: OpenSCADFactory, req: RenderRequest): Promise<RenderResult> {
  const startedAt = performance.now()
  const logs: LogLine[] = []
  const fail = (error: string) => failedResult(error, { logs, renderMs: performance.now() - startedAt })

  let args: string[]
  try {
    args = buildArgs(req.params)
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

  let exitCode: number
  try {
    exitCode = instance.callMain(args)
  } catch (e) {
    if (!isExitStatus(e)) return fail(`OpenSCAD crashed: ${errorMessage(e)}`)
    exitCode = e.status
  }
  if (exitCode !== 0) return fail(`OpenSCAD exited with code ${exitCode}`)

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
