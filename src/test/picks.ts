import type { BoxPick, PartPick } from '../refine/pick'

const BOUNDS = { min: [0, 0, 0], max: [10, 10, 0] } as PartPick['bounds']

/** The Refine screen's pick: "bores", a for loop on lines 15–17. */
export function partPickFixture(): PartPick {
  return {
    kind: 'part',
    statement: { tag: 2, label: 'bores', startLine: 15, endLine: 17, start: 300, end: 420 },
    scope: { startLine: 15, endLine: 17 },
    caption: 'for loop · lines 15–17',
    triangles: Uint32Array.from([0, 1]),
    bounds: BOUNDS,
  }
}

export function boxPickFixture(): BoxPick {
  return { kind: 'box', triangles: Uint32Array.from([0, 1]), bounds: BOUNDS }
}
