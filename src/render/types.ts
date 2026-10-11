export type ParamValue = number | boolean | string | number[]

export interface RenderRequest {
  code: string
  params?: Record<string, ParamValue>
  /** Enabled library names (BOSL2, MCAD), written into the FS before compiling (M3). */
  libraries?: string[]
  /** M5: render the click-to-refine preview: tagged code, coloured OFF export, `mesh.faceTags`, no STL. */
  preview?: { tagged: true }
}

export type Vec3 = [number, number, number]

export interface Bounds {
  min: Vec3
  max: Vec3
}

export interface MeshData {
  /** Non-indexed triangle soup: 9 floats per triangle. */
  positions: Float32Array
  /** Flat per-face normals, same layout as positions. */
  normals: Float32Array
  triangleCount: number
  bounds: Bounds
  /** M5: one tag id per triangle, 0 = untagged. Only on tagged previews. */
  faceTags?: Uint32Array
}

export interface LogLine {
  stream: 'stdout' | 'stderr'
  text: string
}

export interface Diagnostic {
  /** 1-based line in main.scad */
  line: number
  severity: 'error' | 'warning'
  /** OpenSCAD's message without the "in file …, line N" clause, e.g. "Parser error: syntax error". */
  message: string
}

interface ResultBase {
  logs: LogLine[]
  diagnostics: Diagnostic[]
  renderMs: number
}

export type RenderResult =
  | (ResultBase & { ok: true; mesh: MeshData; stl: ArrayBuffer })
  | (ResultBase & { ok: false; error: string })
