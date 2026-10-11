import { formatDims } from '../render/dims'
import { meshFromPositions } from '../render/stl'
import type { Bounds, MeshData, Vec3 } from '../render/types'
import { formatLines, resolveEditScope, statementKind, type LineRange, type StatementRange } from '../scad/statements'

/** A pointer that moved this far between down and up was an orbit drag, not a tap. */
export const TAP_SLOP_PX = 4

export interface ScreenPoint {
  x: number
  y: number
}

export function isTap(down: ScreenPoint | null, up: ScreenPoint): boolean {
  return down !== null && Math.hypot(up.x - down.x, up.y - down.y) < TAP_SLOP_PX
}

export interface PartPick {
  kind: 'part'
  statement: StatementRange
  /** The lines a scoped edit may change (the module definition for a module called once). */
  scope: LineRange
  caption: string
  triangles: Uint32Array
  bounds: Bounds
}

export interface BoxPick {
  kind: 'box'
  triangles: Uint32Array
  bounds: Bounds
}

export type PickResult = PartPick | BoxPick

function collect(count: number, keep: (t: number) => boolean): Uint32Array {
  const out: number[] = []
  for (let t = 0; t < count; t++) if (keep(t)) out.push(t)
  return Uint32Array.from(out)
}

const vertexKey = (p: Float32Array, i: number) => `${p[i]},${p[i + 1]},${p[i + 2]}`

/** Triangles reachable from `start` through shared vertices, visiting only triangles that `include` accepts. */
export function connectedTriangles(mesh: MeshData, start: number, include: (t: number) => boolean): Uint32Array {
  const byVertex = new Map<string, number[]>()
  for (let t = 0; t < mesh.triangleCount; t++) {
    if (!include(t)) continue
    for (let v = 0; v < 3; v++) {
      const key = vertexKey(mesh.positions, t * 9 + v * 3)
      const list = byVertex.get(key)
      if (list) list.push(t)
      else byVertex.set(key, [t])
    }
  }
  const seen = new Set<number>([start])
  const queue = [start]
  while (queue.length > 0) {
    const t = queue.pop()!
    for (let v = 0; v < 3; v++) {
      for (const n of byVertex.get(vertexKey(mesh.positions, t * 9 + v * 3)) ?? []) {
        if (!seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
      }
    }
  }
  return Uint32Array.from([...seen].sort((a, b) => a - b))
}

export function trianglesBounds(mesh: MeshData, triangles: Uint32Array): Bounds {
  if (triangles.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const t of triangles) {
    for (let v = 0; v < 3; v++) {
      for (let a = 0; a < 3; a++) {
        const c = mesh.positions[t * 9 + v * 3 + a]
        if (c < min[a]) min[a] = c
        if (c > max[a]) max[a] = c
      }
    }
  }
  return { min, max }
}

export function subsetMesh(mesh: MeshData, triangles: Uint32Array): MeshData {
  const positions = new Float32Array(triangles.length * 9)
  triangles.forEach((t, i) => positions.set(mesh.positions.subarray(t * 9, t * 9 + 9), i * 9))
  return meshFromPositions(positions)
}

export function resolvePick(opts: {
  mesh: MeshData
  faceIndex: number
  statements: readonly StatementRange[]
  code: string
}): PickResult {
  const { mesh, faceIndex, statements, code } = opts
  const tags = mesh.faceTags
  const tag = tags?.[faceIndex] ?? 0
  const statement = tag === 0 ? undefined : statements.find((s) => s.tag === tag)
  if (tags && statement) {
    const triangles = collect(mesh.triangleCount, (t) => tags[t] === tag)
    const scope = resolveEditScope(code, statement)
    const kind = statementKind(code, statement)
    const caption = kind === statement.label ? formatLines(scope) : `${kind} · ${formatLines(scope)}`
    return { kind: 'part', statement, scope, caption, triangles, bounds: trianglesBounds(mesh, triangles) }
  }
  const triangles = connectedTriangles(mesh, faceIndex, (t) => (tags?.[t] ?? 0) === tag)
  return { kind: 'box', triangles, bounds: trianglesBounds(mesh, triangles) }
}

export function pickTitle(pick: PickResult): string {
  return pick.kind === 'part' ? pick.statement.label : 'Selected region'
}

export function pickSummary(pick: PickResult): string {
  const n = pick.triangles.length
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'triangle' : 'triangles'} · ${formatDims(pick.bounds)}`
}

export function pickScope(pick: PickResult | null): LineRange | null {
  return pick?.kind === 'part' ? pick.scope : null
}
