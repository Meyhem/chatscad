// @vitest-environment node
import { loadLibraryFromDisk, nodeOpenSCADFactory } from '../test/openscadNode'
import { formatDims } from './dims'
import { runOpenSCAD, type OpenSCADFactory } from './runOpenSCAD'
import type { RenderResult } from './types'

let factory: OpenSCADFactory
beforeAll(async () => {
  factory = await nodeOpenSCADFactory()
})

const size = (r: RenderResult) => {
  if (!r.ok) throw new Error(`render failed: ${r.error}\n${r.logs.map((l) => l.text).join('\n')}`)
  return r.mesh.bounds.max.map((v, i) => v - r.mesh.bounds.min[i]!)
}

it('applies -D overrides in the real OpenSCAD WASM', async () => {
  const r = await runOpenSCAD(factory, { code: 'w = 10; // [1:50]\ncube([w, 2, 3]);', params: { w: 25 } })
  expect(r.ok && formatDims(r.mesh.bounds)).toBe('25 × 2 × 3 mm')
}, 60_000)

it('includes BOSL2 only when the library is enabled', async () => {
  const code = 'include <BOSL2/std.scad>\ncuboid([10, 20, 30], rounding = 2);'
  const withLib = await runOpenSCAD(factory, { code, libraries: ['BOSL2'] }, loadLibraryFromDisk)
  expect(size(withLib).map((v) => Math.round(v))).toEqual([10, 20, 30])
  const without = await runOpenSCAD(factory, { code }, loadLibraryFromDisk)
  expect(without).toMatchObject({ ok: false, error: 'The model produced no 3D geometry' })
}, 60_000)

it('uses MCAD modules', async () => {
  const code = 'use <MCAD/boxes.scad>\nroundedCube([10, 12, 14], 2, true, true);'
  const r = await runOpenSCAD(factory, { code, libraries: ['MCAD'] }, loadLibraryFromDisk)
  expect(size(r).map((v) => Math.round(v))).toEqual([10, 12, 14])
}, 60_000)
