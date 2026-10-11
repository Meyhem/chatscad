import { binaryStl, BOX_TRI } from '../test/stl'
import { INPUT_PATH, OUTPUT_PATH } from './args'
import { runOpenSCAD, type OpenSCADFactory, type OpenSCADFactoryOptions, type OpenSCADInstance } from './runOpenSCAD'

type FakeInstance = OpenSCADInstance & { files: Map<string, Uint8Array | string>; opts: OpenSCADFactoryOptions }

function fakeFactory(behaviour: (inst: FakeInstance, args: string[]) => number) {
  const created: FakeInstance[] = []
  const factory: OpenSCADFactory = async (opts) => {
    const files = new Map<string, Uint8Array | string>()
    const inst: FakeInstance = {
      files,
      opts,
      FS: {
        writeFile: (path, data) => void files.set(path, data),
        readFile: (path) => {
          const f = files.get(path)
          if (f === undefined) throw new Error(`ENOENT ${path}`)
          return typeof f === 'string' ? new TextEncoder().encode(f) : f
        },
      },
      callMain: (args) => behaviour(inst, args),
    }
    created.push(inst)
    return inst
  }
  return { factory, created }
}

const writesBox = (inst: FakeInstance) => {
  inst.files.set(OUTPUT_PATH, new Uint8Array(binaryStl([BOX_TRI])))
  return 0
}

it('writes the code, passes -D overrides, and returns the parsed mesh and STL', async () => {
  let seenArgs: string[] = []
  const { factory, created } = fakeFactory((inst, args) => {
    seenArgs = args
    inst.opts.print('ECHO: 42')
    return writesBox(inst)
  })

  const result = await runOpenSCAD(factory, { code: 'cube(20);', params: { w: 5 } })

  expect(created[0].files.get(INPUT_PATH)).toBe('cube(20);')
  expect(seenArgs).toContain('w=5')
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.mesh.triangleCount).toBe(1)
  expect(result.mesh.bounds.max).toEqual([20, 20, 10])
  expect(result.stl.byteLength).toBe(134)
  expect(result.logs).toEqual([{ stream: 'stdout', text: 'ECHO: 42' }])
})

it('reports a compile error with diagnostics when OpenSCAD exits non-zero', async () => {
  const { factory } = fakeFactory((inst) => {
    inst.opts.printErr('ERROR: Parser error in file "/main.scad", line 3: syntax error')
    return 1
  })
  const result = await runOpenSCAD(factory, { code: 'cube(' })
  expect(result).toMatchObject({ ok: false, error: 'OpenSCAD exited with code 1' })
  expect(result.diagnostics).toEqual([expect.objectContaining({ line: 3, severity: 'error' })])
})

it('treats a thrown Emscripten ExitStatus as an exit code', async () => {
  const { factory } = fakeFactory(() => {
    throw { name: 'ExitStatus', status: 1 }
  })
  expect(await runOpenSCAD(factory, { code: 'x' })).toMatchObject({ ok: false, error: 'OpenSCAD exited with code 1' })
})

it('reports a crash when callMain throws an Error', async () => {
  const { factory } = fakeFactory(() => {
    throw new Error('memory access out of bounds')
  })
  expect(await runOpenSCAD(factory, { code: 'x' })).toMatchObject({
    ok: false,
    error: 'OpenSCAD crashed: memory access out of bounds',
  })
})

it('reports no output when the model produces nothing (empty file, only echo)', async () => {
  const { factory } = fakeFactory(() => 0)
  expect(await runOpenSCAD(factory, { code: 'echo("hi");' })).toMatchObject({
    ok: false,
    error: 'OpenSCAD produced no output (is the model empty?)',
  })
})

it('reports an empty model when the STL has zero triangles', async () => {
  const { factory } = fakeFactory((inst) => {
    inst.files.set(OUTPUT_PATH, new Uint8Array(binaryStl([])))
    return 0
  })
  expect(await runOpenSCAD(factory, { code: '' })).toMatchObject({ ok: false, error: 'Model is empty' })
})

it('reports invalid parameters without loading OpenSCAD', async () => {
  const { factory, created } = fakeFactory(writesBox)
  const result = await runOpenSCAD(factory, { code: 'cube(1);', params: { 'bad name': 1 } })
  expect(result).toMatchObject({ ok: false, error: 'Invalid parameter name: bad name' })
  expect(created).toHaveLength(0)
})

it('reports a load failure when the factory rejects', async () => {
  const factory: OpenSCADFactory = () => Promise.reject(new Error('wasm 404'))
  expect(await runOpenSCAD(factory, { code: 'cube(1);' })).toMatchObject({
    ok: false,
    error: 'Failed to load OpenSCAD: wasm 404',
  })
})

it('uses a fresh instance for every render', async () => {
  const { factory, created } = fakeFactory(writesBox)
  await runOpenSCAD(factory, { code: 'cube(1);' })
  await runOpenSCAD(factory, { code: 'cube(2);' })
  expect(created).toHaveLength(2)
})
