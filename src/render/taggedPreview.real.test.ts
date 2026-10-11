// @vitest-environment node
import { loadRealOpenSCAD, REAL_OPENSCAD_AVAILABLE } from '../test/realOpenSCAD'
import { runOpenSCAD } from './runOpenSCAD'

const BORED = [
  'module plate() { cube([40, 40, 10]); }',
  'module peg() { translate([15, 15, 10]) cube([10, 10, 10]); }',
  'difference() {',
  '  union() { plate(); peg(); }',
  '  for (i = [0 : 1]) translate([5 + i * 30, 5, -1]) cylinder(h = 12, d = 3, $fn = 16);',
  '}',
  '',
].join('\n')

describe.runIf(REAL_OPENSCAD_AVAILABLE || Boolean(process.env.CI))('tagged preview in the pinned OpenSCAD build', () => {
  it('tags every triangle of the main assembly, including the walls of subtracted bores', async () => {
    const result = await runOpenSCAD(await loadRealOpenSCAD(), { code: BORED, preview: { tagged: true } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new Set(result.mesh.faceTags)).toEqual(new Set([1, 2]))
  }, 60_000)

  it('has the same bounds as the untagged render', async () => {
    const factory = await loadRealOpenSCAD()
    const [tagged, plain] = await Promise.all([
      runOpenSCAD(factory, { code: BORED, preview: { tagged: true } }),
      runOpenSCAD(factory, { code: BORED }),
    ])
    expect(tagged.ok && plain.ok).toBe(true)
    if (!tagged.ok || !plain.ok) return
    expect(tagged.mesh.bounds).toEqual(plain.mesh.bounds)
  }, 60_000)
})
