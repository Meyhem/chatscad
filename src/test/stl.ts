import type { Vec3 } from '../render/types'

export type Tri = [Vec3, Vec3, Vec3]

/** One triangle whose bounding box is 20 × 20 × 10 mm. */
export const BOX_TRI: Tri = [
  [0, 0, 0],
  [20, 20, 0],
  [0, 0, 10],
]

export function binaryStl(tris: Tri[]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + tris.length * 50)
  const view = new DataView(buf)
  new Uint8Array(buf).set(new TextEncoder().encode('solid binary header that starts with solid'))
  view.setUint32(80, tris.length, true)
  tris.forEach((tri, t) =>
    tri.forEach((p, i) => p.forEach((c, k) => view.setFloat32(84 + t * 50 + 12 + (i * 3 + k) * 4, c, true))),
  )
  return buf
}

export function asciiStl(tris: Tri[]): string {
  const facets = tris
    .map(
      (tri) =>
        `  facet normal 0 0 0\n    outer loop\n${tri.map((p) => `      vertex ${p.join(' ')}`).join('\n')}\n    endloop\n  endfacet`,
    )
    .join('\n')
  return `solid model\n${facets}\nendsolid model\n`
}
