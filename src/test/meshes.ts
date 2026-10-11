import { meshFromPositions } from '../render/stl'
import type { MeshData } from '../render/types'

/** A mesh from triangles of 9 numbers each, optionally with one tag per triangle. */
export function meshOf(triangles: number[][], faceTags?: number[]): MeshData {
  const mesh = meshFromPositions(Float32Array.from(triangles.flat()))
  return faceTags ? { ...mesh, faceTags: Uint32Array.from(faceTags) } : mesh
}
