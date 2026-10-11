import type { MeshData, Vec3 } from './types'

export function parseStl(buffer: ArrayBuffer): MeshData {
  if (buffer.byteLength >= 84) {
    const view = new DataView(buffer)
    const count = view.getUint32(80, true)
    if (84 + count * 50 === buffer.byteLength) return parseBinary(view, count)
  }
  const text = new TextDecoder().decode(buffer)
  if (/^\s*solid/.test(text)) return parseAscii(text)
  throw new Error('Unrecognised STL data')
}

function parseBinary(view: DataView, count: number): MeshData {
  const positions = new Float32Array(count * 9)
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(base + k * 4, true)
  }
  return finalize(positions)
}

function parseAscii(text: string): MeshData {
  const nums: number[] = []
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) nums.push(Number(m[1]), Number(m[2]), Number(m[3]))
  if (nums.length % 9 !== 0 || nums.some((n) => !Number.isFinite(n))) throw new Error('Malformed ASCII STL')
  return finalize(new Float32Array(nums))
}

function finalize(positions: Float32Array): MeshData {
  const triangleCount = positions.length / 9
  const normals = new Float32Array(positions.length)
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]

  for (let o = 0; o < positions.length; o += 9) {
    const ax = positions[o + 3] - positions[o], ay = positions[o + 4] - positions[o + 1], az = positions[o + 5] - positions[o + 2]
    const bx = positions[o + 6] - positions[o], by = positions[o + 7] - positions[o + 1], bz = positions[o + 8] - positions[o + 2]
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    for (let v = 0; v < 3; v++) {
      normals[o + v * 3] = nx
      normals[o + v * 3 + 1] = ny
      normals[o + v * 3 + 2] = nz
    }
  }

  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const p = positions[i + a]
      if (p < min[a]) min[a] = p
      if (p > max[a]) max[a] = p
    }
  }

  const bounds = triangleCount > 0 ? { min, max } : { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 }
  return { positions, normals, triangleCount, bounds }
}
