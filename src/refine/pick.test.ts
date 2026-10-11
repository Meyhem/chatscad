import { listTaggableStatements } from '../scad/statements'
import { meshOf } from '../test/meshes'
import { boxPickFixture, partPickFixture } from '../test/picks'
import { connectedTriangles, isTap, pickScope, pickSummary, pickTitle, resolvePick } from './pick'

// Line 1 defines peg (called once), lines 2–5 are the main assembly.
const CODE = 'module peg() { cube(1); }\nunion() {\n  cube([2, 2, 1]);\n  translate([0, 0, 1]) peg();\n}\n'
const statements = listTaggableStatements(CODE) // cube (tag 1, line 3), peg (tag 2, line 4)

const MESH = meshOf(
  [
    [0, 0, 0, 2, 0, 0, 2, 2, 0], //       0: tag 1
    [0, 0, 0, 2, 2, 0, 0, 2, 0], //       1: tag 1
    [0, 0, 1, 1, 0, 1, 1, 1, 2], //       2: tag 2
    [5, 5, 5, 6, 5, 5, 6, 6, 5], //       3: tag 0
    [6, 6, 5, 7, 6, 5, 7, 7, 6], //       4: tag 0, shares (6, 6, 5) with 3
    [20, 20, 20, 21, 20, 20, 21, 21, 20], // 5: tag 0, separate
  ],
  [1, 1, 2, 0, 0, 0],
)

describe('isTap', () => {
  it('counts a pointer that moved less than 4 px as a tap', () => {
    expect(isTap({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(true)
    expect(isTap({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(false)
    expect(isTap({ x: 10, y: 10 }, { x: 13, y: 13 })).toBe(false)
    expect(isTap(null, { x: 0, y: 0 })).toBe(false)
  })
})

describe('resolvePick', () => {
  it('maps a tagged face to its statement, every triangle of that tag, and the edit scope', () => {
    const pick = resolvePick({ mesh: MESH, faceIndex: 0, statements, code: CODE })
    expect(pick).toMatchObject({ kind: 'part', statement: { label: 'cube', tag: 1 }, scope: { startLine: 3, endLine: 3 }, caption: 'line 3' })
    expect(Array.from(pick.triangles)).toEqual([0, 1])
    expect(pick.bounds).toEqual({ min: [0, 0, 0], max: [2, 2, 0] })
  })

  it('scopes a module called once to its definition and says so in the caption', () => {
    const pick = resolvePick({ mesh: MESH, faceIndex: 2, statements, code: CODE })
    expect(pick).toMatchObject({ kind: 'part', statement: { label: 'peg' }, scope: { startLine: 1, endLine: 1 }, caption: 'module call · line 1' })
  })

  it('falls back to the connected untagged region when tags were lost', () => {
    const pick = resolvePick({ mesh: MESH, faceIndex: 3, statements, code: CODE })
    expect(pick.kind).toBe('box')
    expect(Array.from(pick.triangles)).toEqual([3, 4])
    expect(pick.bounds).toEqual({ min: [5, 5, 5], max: [7, 7, 6] })
  })

  it('falls back to a region when the mesh has no tags at all', () => {
    const plain = meshOf([
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [1, 0, 0, 1, 1, 0, 0, 1, 0],
      [9, 9, 9, 10, 9, 9, 9, 10, 9],
    ])
    const pick = resolvePick({ mesh: plain, faceIndex: 1, statements: [], code: '' })
    expect(pick.kind).toBe('box')
    expect(Array.from(pick.triangles)).toEqual([0, 1])
  })

  it('never selects a statement for a tag it does not know', () => {
    const odd = meshOf([[0, 0, 0, 1, 0, 0, 0, 1, 0]], [7])
    expect(resolvePick({ mesh: odd, faceIndex: 0, statements, code: CODE }).kind).toBe('box')
  })
})

describe('connectedTriangles', () => {
  it('walks shared vertices only through included triangles', () => {
    expect(Array.from(connectedTriangles(MESH, 3, (t) => t >= 3))).toEqual([3, 4])
  })
})

describe('copy', () => {
  it('titles, summarises and scopes picks', () => {
    expect(pickTitle(partPickFixture())).toBe('bores')
    expect(pickTitle(boxPickFixture())).toBe('Selected region')
    expect(pickSummary(partPickFixture())).toBe('2 triangles · 10 × 10 × 0 mm')
    expect(pickSummary({ ...boxPickFixture(), triangles: Uint32Array.from([0]) })).toBe('1 triangle · 10 × 10 × 0 mm')
    expect(pickScope(partPickFixture())).toEqual({ startLine: 15, endLine: 17 })
    expect(pickScope(boxPickFixture())).toBeNull()
    expect(pickScope(null)).toBeNull()
  })

  it('formats large counts with separators', () => {
    expect(pickSummary({ ...boxPickFixture(), triangles: new Uint32Array(18_432) })).toBe('18,432 triangles · 10 × 10 × 0 mm')
  })
})
