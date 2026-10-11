// @vitest-environment node
import { formatDimParts } from '../render/dims'
import { runOpenSCAD, type OpenSCADFactory } from '../render/runOpenSCAD'
import { parseCustomizer } from '../scad/customizer'
import { nodeOpenSCADFactory } from '../test/openscadNode'
import { EXAMPLES } from './index'

let factory: OpenSCADFactory
beforeAll(async () => {
  factory = await nodeOpenSCADFactory()
})

const sliderValues = (code: string, end: 'min' | 'max') =>
  Object.fromEntries(parseCustomizer(code).flatMap((p) => (p.control.kind === 'slider' ? [[p.name, p.control[end]]] : [])))

describe.each(EXAMPLES.map((e) => [e.name, e] as const))('%s', (_name, example) => {
  it('renders at its defaults in the real OpenSCAD WASM with a printable size', async () => {
    const r = await runOpenSCAD(factory, { code: example.code })
    if (!r.ok) throw new Error(`${example.id}: ${r.error}\n${r.logs.map((l) => l.text).join('\n')}`)
    expect(r.mesh.triangleCount).toBeGreaterThan(0)
    for (const size of formatDimParts(r.mesh.bounds).map(Number)) {
      expect(size).toBeGreaterThan(1)
      expect(size).toBeLessThan(400)
    }
    expect(r.logs.filter((l) => /^(WARNING|ERROR)/.test(l.text))).toEqual([])
  }, 60_000)

  it.each(['min', 'max'] as const)('renders with every slider at its %s', async (end) => {
    const r = await runOpenSCAD(factory, { code: example.code, params: sliderValues(example.code, end) })
    expect(r.ok ? 'ok' : r.error).toBe('ok')
  }, 60_000)
})
