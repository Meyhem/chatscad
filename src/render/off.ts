import { decodeTag } from '../scad/tagging'
import { meshFromPositions } from './stl'
import type { MeshData } from './types'

function faceTag(colour: string[], maxTag: number): number {
  if (colour.length < 3) return 0
  const channels = colour.slice(0, 3)
  const values = channels.map(Number)
  if (values.some((v) => !Number.isFinite(v))) return 0
  const scale = channels.some((c) => c.includes('.')) ? 255 : 1
  return decodeTag(values[0] * scale, values[1] * scale, values[2] * scale, maxTag)
}

/** OpenSCAD's OFF export with per-face colours (the click-to-refine preview format, D12). */
export function parseOff(buffer: ArrayBuffer, maxTag: number): MeshData {
  const lines = new TextDecoder()
    .decode(buffer)
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => l !== '')
  const header = /^C?N?OFF\b/.exec(lines[0] ?? '')
  if (!header) throw new Error('Unrecognised OFF data')

  let cursor = 1
  const rest = lines[0].slice(header[0].length).trim()
  const counts = (rest !== '' ? rest : (lines[cursor++] ?? '')).split(/\s+/).map(Number)
  const [nv, nf] = counts
  if (!Number.isInteger(nv) || !Number.isInteger(nf) || nv < 0 || nf < 0) throw new Error('Malformed OFF header')

  const vertices = new Float64Array(nv * 3)
  for (let v = 0; v < nv; v++) {
    const p = (lines[cursor++] ?? '').split(/\s+/).slice(0, 3).map(Number)
    if (p.length < 3 || p.some((n) => !Number.isFinite(n))) throw new Error('Malformed OFF vertex')
    vertices.set(p, v * 3)
  }

  const positions: number[] = []
  const tags: number[] = []
  for (let f = 0; f < nf; f++) {
    const parts = (lines[cursor++] ?? '').split(/\s+/)
    const n = Number(parts[0])
    const index = parts.slice(1, 1 + n).map(Number)
    if (!Number.isInteger(n) || n < 3 || index.length !== n || index.some((i) => !Number.isInteger(i) || i < 0 || i >= nv)) {
      throw new Error('Malformed OFF face')
    }
    const tag = faceTag(parts.slice(1 + n), maxTag)
    for (let k = 1; k + 1 < n; k++) {
      for (const vi of [index[0], index[k], index[k + 1]]) positions.push(vertices[vi * 3], vertices[vi * 3 + 1], vertices[vi * 3 + 2])
      tags.push(tag)
    }
  }
  return { ...meshFromPositions(new Float32Array(positions)), faceTags: Uint32Array.from(tags) }
}
