// @vitest-environment node
/**
 * D12 spike: which export format keeps per-face colour through Manifold CSG in the pinned OpenSCAD build?
 *
 * Decision rule: use OFF when colours survive difference, union, translate and for in OFF; otherwise 3MF.
 * Colours on children inside hull() and minkowski() are expected to be lost (bounding-box fallback).
 *
 * Recorded 2026-10-11 against OpenSCAD-2026.10.08-WebAssembly-web.zip: OFF keeps colours. Decision: OFF.
 * The test stays in the suite so a deliberate WASM bump that breaks colour survival fails here first.
 */
import { unzipSync } from 'fflate'
import { loadRealOpenSCAD, REAL_OPENSCAD_AVAILABLE } from '../test/realOpenSCAD'

type Format = 'off' | '3mf'

/** Tag n as the colour [0, 0, n / 255], the same encoding Task 3 uses for small ids. */
const T = (n: number, body: string) => `color([0, 0, ${n} / 255]) ${body}`

async function faceColours(code: string, format: Format): Promise<Map<string, number>> {
  const factory = await loadRealOpenSCAD()
  const logs: string[] = []
  const inst = await factory({ noInitialRun: true, print: (t) => logs.push(t), printErr: (t) => logs.push(t) })
  inst.FS.writeFile('/main.scad', code)
  const out = `/out.${format}`
  let exitCode: number
  try {
    exitCode = inst.callMain(['/main.scad', '-o', out, '--backend=manifold', `--export-format=${format}`])
  } catch (e) {
    exitCode = (e as { status?: number }).status ?? -1
  }
  if (exitCode !== 0) throw new Error(`OpenSCAD exited with ${exitCode}:\n${logs.join('\n')}`)
  const bytes = inst.FS.readFile(out)
  return format === 'off' ? offColours(bytes) : threeMfColours(bytes)
}

/** Face colour histogram of an OFF file, keyed "r g b" in 0–255 ("none" for faces without a colour). */
function offColours(bytes: Uint8Array): Map<string, number> {
  const lines = new TextDecoder()
    .decode(bytes)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  const [nv, nf] = lines[1].split(/\s+/).map(Number)
  const counts = new Map<string, number>()
  for (const line of lines.slice(2 + nv, 2 + nv + nf)) {
    const parts = line.split(/\s+/)
    const n = Number(parts[0])
    const rgb = parts.slice(1 + n, 4 + n)
    const key =
      rgb.length === 3 ? rgb.map((c) => String(Math.round(c.includes('.') ? Number(c) * 255 : Number(c)))).join(' ') : 'none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Face colour histogram of a 3MF file (one basematerials group, triangle p1 or the object's pindex). */
function threeMfColours(bytes: Uint8Array): Map<string, number> {
  const xml = new TextDecoder().decode(unzipSync(bytes)['3D/3dmodel.model'])
  const bases = [...xml.matchAll(/<base\b[^>]*displaycolor="#([0-9A-Fa-f]{6})/g)].map((m) => {
    const v = parseInt(m[1], 16)
    return `${(v >> 16) & 255} ${(v >> 8) & 255} ${v & 255}`
  })
  const objectDefault = Number(/<object\b[^>]*\bpindex="(\d+)"/.exec(xml)?.[1] ?? 0)
  const counts = new Map<string, number>()
  for (const m of xml.matchAll(/<triangle\b([^>]*)\/>/g)) {
    const p1 = /\bp1="(\d+)"/.exec(m[1])?.[1]
    const key = bases[p1 === undefined ? objectDefault : Number(p1)] ?? 'none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** The small tag ids (colour 0 0 n) present in a histogram, sorted. */
function tagsIn(colours: Map<string, number>): number[] {
  return [...colours.keys()]
    .map((k) => k.split(' ').map(Number))
    .filter(([r, g, b]) => r === 0 && g === 0 && b >= 1 && b <= 9)
    .map(([, , b]) => b)
    .sort((a, b) => a - b)
}

const SURVIVES: Record<string, string> = {
  'difference (children tagged)': `difference() { ${T(1, 'cube(20);')} ${T(2, 'translate([10, 10, -1]) cylinder(h = 30, r = 4, $fn = 16);')} }`,
  'union (implicit, top level)': `${T(1, 'cube(10);')} ${T(2, 'translate([5, 5, 5]) cube(10);')}`,
  'union (explicit)': `union() { ${T(1, 'cube(10);')} ${T(2, 'translate([5, 5, 5]) cube(10);')} }`,
  intersection: `intersection() { ${T(1, 'cube(10);')} ${T(2, 'translate([5, 5, 5]) cube(10);')} }`,
  'translate and rotate': `${T(1, 'translate([5, 0, 0]) rotate([0, 0, 45]) cube(10);')} ${T(2, 'translate([30, 0, 0]) sphere(3, $fn = 12);')}`,
  'for loop': `${T(1, 'for (i = [0 : 3]) translate([i * 12, 0, 0]) cube(5);')} ${T(2, 'translate([0, 20, 0]) cube(3);')}`,
  linear_extrude: `${T(1, 'linear_extrude(5) square(10);')} ${T(2, 'translate([20, 0, 0]) cube(3);')}`,
  'hull (tagged from outside)': `${T(1, 'hull() { cube(5); translate([10, 0, 0]) sphere(2, $fn = 8); }')} ${T(2, 'translate([30, 0, 0]) cube(3);')}`,
  'minkowski (tagged from outside)': `${T(1, 'minkowski() { cube(5); sphere(1, $fn = 8); }')} ${T(2, 'translate([30, 0, 0]) cube(3);')}`,
}

const LOST: Record<string, string> = {
  'hull (children tagged)': `hull() { ${T(1, 'cube(5);')} ${T(2, 'translate([10, 0, 0]) sphere(2, $fn = 8);')} }`,
  'minkowski (children tagged)': `minkowski() { ${T(1, 'cube(5);')} ${T(2, 'sphere(1, $fn = 8);')} }`,
}

describe.runIf(REAL_OPENSCAD_AVAILABLE || Boolean(process.env.CI))('D12: face colours in the pinned OpenSCAD build', () => {
  it.each(Object.entries(SURVIVES))('OFF keeps both tags through %s', async (_name, code) => {
    expect(tagsIn(await faceColours(code, 'off'))).toEqual([1, 2])
  }, 60_000)

  it.each(Object.entries(LOST))('OFF loses tags on children inside %s (bounding-box fallback)', async (_name, code) => {
    expect(tagsIn(await faceColours(code, 'off'))).toEqual([])
  }, 60_000)

  it('an outer tag overrides the user\'s own colour inside it', async () => {
    const colours = await faceColours(T(1, 'color("red") cube(5);'), 'off')
    expect([...colours.keys()]).toEqual(['0 0 1'])
  }, 60_000)

  it('an outer tag on a boolean overrides tags on its children, so tags must never nest', async () => {
    const code = T(1, `difference() { cube(20); ${T(2, 'translate([10, 10, -1]) cylinder(h = 30, r = 4, $fn = 16);')} }`)
    expect(tagsIn(await faceColours(code, 'off'))).toEqual([1])
  }, 60_000)

  it('untagged geometry keeps a colour that is not one of our tags', async () => {
    const colours = await faceColours(`${T(1, 'cube(10);')} translate([20, 0, 0]) cube(3);`, 'off')
    expect(tagsIn(colours)).toEqual([1])
    expect(colours.size).toBe(2)
    expect(colours.has('none')).toBe(false)
  }, 60_000)

  it('3MF keeps both tags through difference (fallback format)', async () => {
    expect(tagsIn(await faceColours(SURVIVES['difference (children tagged)'], '3mf'))).toEqual([1, 2])
  }, 60_000)
})
