import { binaryStl, BOX_TRI } from '../test/stl'
import { INPUT_PATH, OUTPUT_PATH, PREVIEW_OUTPUT_PATH, toPreviewArgs } from './args'
import { runOpenSCAD, type OpenSCADFactory, type OpenSCADFactoryOptions, type OpenSCADInstance } from './runOpenSCAD'
import type { LibraryBundle } from './libraries'

type FakeInstance = OpenSCADInstance & { files: Map<string, Uint8Array | string>; dirs: string[]; opts: OpenSCADFactoryOptions }

function fakeFactory(behaviour: (inst: FakeInstance, args: string[]) => number) {
  const created: FakeInstance[] = []
  const factory: OpenSCADFactory = async (opts) => {
    const files = new Map<string, Uint8Array | string>()
    const dirs: string[] = []
    const inst: FakeInstance = {
      files,
      dirs,
      opts,
      ENV: {},
      FS: {
        writeFile: (path, data) => void files.set(path, data),
        readFile: (path) => {
          const f = files.get(path)
          if (f === undefined) throw new Error(`ENOENT ${path}`)
          return typeof f === 'string' ? new TextEncoder().encode(f) : f
        },
        mkdirTree: (path) => void dirs.push(path),
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

it('explains an empty model in plain words, using the real OpenSCAD stderr text', async () => {
  const { factory } = fakeFactory((inst) => {
    inst.opts.printErr('Current top level object is empty.')
    return 1
  })
  expect(await runOpenSCAD(factory, { code: 'echo("hi");' })).toMatchObject({
    ok: false,
    error: 'The model produced no 3D geometry',
  })
})

it('explains a 2D-only model in plain words', async () => {
  const { factory } = fakeFactory((inst) => {
    inst.opts.printErr('Current top level object is not a 3D object.')
    return 1
  })
  expect(await runOpenSCAD(factory, { code: 'square(10);' })).toMatchObject({
    ok: false,
    error: 'The model is 2D only; STL needs a 3D object',
  })
})

describe('libraries', () => {
  const bosl2: LibraryBundle = { name: 'BOSL2', version: 'v', source: 'u', files: { 'std.scad': 'include <shapes3d.scad>', 'shapes3d.scad': '' } }

  it('writes enabled libraries under /libraries and points OPENSCADPATH there before compiling', async () => {
    let seenEnv: string | undefined
    const { factory, created } = fakeFactory((inst) => {
      seenEnv = inst.ENV.OPENSCADPATH
      return writesBox(inst)
    })
    const loader = vi.fn(async () => bosl2)
    const result = await runOpenSCAD(factory, { code: 'include <BOSL2/std.scad>', libraries: ['BOSL2'] }, loader)
    expect(result.ok).toBe(true)
    expect(loader).toHaveBeenCalledWith('BOSL2')
    expect(seenEnv).toBe('/libraries')
    expect(created[0]!.dirs).toEqual(['/libraries/BOSL2'])
    expect(created[0]!.files.get('/libraries/BOSL2/std.scad')).toBe('include <shapes3d.scad>')
  })

  it('leaves the file system and environment alone when no library is enabled', async () => {
    const { factory, created } = fakeFactory(writesBox)
    await runOpenSCAD(factory, { code: 'cube(1);' }, vi.fn())
    expect(created[0]!.dirs).toEqual([])
    expect(created[0]!.ENV).toEqual({})
  })

  it('fails with a plain message for an unknown library, without starting OpenSCAD', async () => {
    const { factory, created } = fakeFactory(writesBox)
    const result = await runOpenSCAD(factory, { code: 'x', libraries: ['../etc'] }, vi.fn())
    expect(result).toMatchObject({ ok: false, error: 'Unknown library "../etc"; available: BOSL2, MCAD' })
    expect(created).toHaveLength(0)
  })

  it('names the library when it cannot be loaded', async () => {
    const { factory } = fakeFactory(writesBox)
    const loader = vi.fn(async () => {
      throw new Error('GET /libraries/MCAD.json failed with 404')
    })
    expect(await runOpenSCAD(factory, { code: 'x', libraries: ['MCAD'] }, loader)).toMatchObject({
      ok: false,
      error: "Couldn't load the MCAD library: GET /libraries/MCAD.json failed with 404",
    })
  })
})

describe('tagged preview', () => {
  const TWO_PARTS = 'cube(10);\ntranslate([20, 0, 0]) cube(5);\n'
  const OFF_TWO = ['OFF', '4 2 0', '0 0 0', '10 0 0', '0 10 0', '20 0 0', '3 0 1 2 0 0 1', '3 1 3 2 0 0 2'].join('\n')

  it('renders tagged code to OFF and returns one tag per triangle and no STL', async () => {
    let seenArgs: string[] = []
    const { factory, created } = fakeFactory((inst, args) => {
      seenArgs = args
      inst.files.set(PREVIEW_OUTPUT_PATH, OFF_TWO)
      return 0
    })
    const result = await runOpenSCAD(factory, { code: TWO_PARTS, params: { w: 5 }, preview: { tagged: true } })

    expect(created[0].files.get(INPUT_PATH)).toBe(
      'color([0 / 255, 0 / 255, 1 / 255]) cube(10);\ncolor([0 / 255, 0 / 255, 2 / 255]) translate([20, 0, 0]) cube(5);\n',
    )
    expect(seenArgs).toEqual(expect.arrayContaining(['-o', PREVIEW_OUTPUT_PATH, '--export-format=off', '--backend=manifold', 'w=5']))
    expect(seenArgs).not.toContain('--export-format=binstl')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.from(result.mesh.faceTags ?? [])).toEqual([1, 2])
    expect(result.stl.byteLength).toBe(0)
  })

  it('reports unreadable preview output as a failed render', async () => {
    const { factory } = fakeFactory((inst) => {
      inst.files.set(PREVIEW_OUTPUT_PATH, 'ply')
      return 0
    })
    expect(await runOpenSCAD(factory, { code: TWO_PARTS, preview: { tagged: true } })).toMatchObject({
      ok: false,
      error: 'Unrecognised OFF data',
    })
  })

  it('leaves normal renders untouched: untagged code, binary STL, no tags', async () => {
    const { factory, created } = fakeFactory(writesBox)
    const result = await runOpenSCAD(factory, { code: TWO_PARTS })
    expect(created[0].files.get(INPUT_PATH)).toBe(TWO_PARTS)
    expect(result.ok && result.mesh.faceTags).toBeUndefined()
    expect(result.ok && result.stl.byteLength).toBe(134)
  })
})

describe('toPreviewArgs', () => {
  it('swaps only the output path and the export format', () => {
    expect(toPreviewArgs(['/main.scad', '-o', '/out.stl', '--backend=manifold', '--export-format=binstl', '-D', 'w=5'])).toEqual([
      '/main.scad', '-o', PREVIEW_OUTPUT_PATH, '--backend=manifold', '--export-format=off', '-D', 'w=5',
    ])
  })
})
