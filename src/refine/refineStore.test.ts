import { useAppStore } from '../state/store'
import { meshOf } from '../test/meshes'
import { okResult } from '../test/results'
import { partTagsState, useRefineStore } from './refineStore'

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const TWO_PARTS = 'cube(10);\ntranslate([20, 0, 0]) cube(5);\n'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useRefineStore.setState(useRefineStore.getInitialState(), true)
})

it('asks for a tagged render when the code has two or more parts', () => {
  const mesh = meshOf([TRI, TRI])
  expect(useRefineStore.getState().baseRendered(TWO_PARTS, mesh)).toBe(true)
  expect(useRefineStore.getState().pendingBase).toBe(mesh)
  expect(useRefineStore.getState().tags).toBeNull()
})

it('fills in the tags without a render when the code has exactly one part', () => {
  const mesh = meshOf([TRI, TRI])
  expect(useRefineStore.getState().baseRendered('cube(10);\n', mesh)).toBe(false)
  const tags = useRefineStore.getState().tags
  expect(tags?.baseMesh).toBe(mesh)
  expect(Array.from(tags?.mesh.faceTags ?? [])).toEqual([1, 1])
  expect(tags?.statements.map((s) => s.label)).toEqual(['cube'])
})

it('has nothing to pick when the code has no parts', () => {
  expect(useRefineStore.getState().baseRendered('w = 1;\n', meshOf([TRI]))).toBe(false)
  expect(useRefineStore.getState().tags).toBeNull()
  expect(useRefineStore.getState().pendingBase).toBeNull()
})

it('clears the pick whenever a new normal render arrives', () => {
  useRefineStore.setState({ pick: { kind: 'box', triangles: Uint32Array.from([0]), bounds: { min: [0, 0, 0], max: [1, 1, 0] } } })
  useRefineStore.getState().baseRendered(TWO_PARTS, meshOf([TRI]))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('accepts a tagged result only while its base mesh is still on screen', () => {
  const base = okResult()
  if (!base.ok) throw new Error('fixture')
  useAppStore.getState().renderFinished(base, TWO_PARTS)
  useRefineStore.getState().baseRendered(TWO_PARTS, base.mesh)
  const tagged = { ...base, stl: new ArrayBuffer(0), mesh: { ...base.mesh, faceTags: Uint32Array.from([2]) } }
  useRefineStore.getState().taggedFinished(tagged, TWO_PARTS)
  expect(useRefineStore.getState().tags?.mesh).toBe(tagged.mesh)
  expect(useRefineStore.getState().pendingBase).toBeNull()

  useRefineStore.setState({ tags: null })
  useRefineStore.getState().baseRendered(TWO_PARTS, base.mesh)
  const newer = okResult()
  useAppStore.getState().renderFinished(newer, TWO_PARTS)
  useRefineStore.getState().taggedFinished(tagged, TWO_PARTS)
  expect(useRefineStore.getState().tags).toBeNull()
})

it('ignores failed tagged renders and results without tags', () => {
  const base = okResult()
  if (!base.ok) throw new Error('fixture')
  useAppStore.getState().renderFinished(base, TWO_PARTS)
  useRefineStore.getState().baseRendered(TWO_PARTS, base.mesh)
  useRefineStore.getState().taggedFinished(base, TWO_PARTS)
  expect(useRefineStore.getState().tags).toBeNull()
})

it('reports whether the tags for a mesh are ready, pending or absent', () => {
  const mesh = meshOf([TRI])
  const tags = { baseMesh: mesh, code: '', mesh, statements: [] }
  expect(partTagsState(null, null, null)).toBe('none')
  expect(partTagsState(mesh, tags, null)).toBe('ready')
  expect(partTagsState(mesh, null, mesh)).toBe('pending')
  expect(partTagsState(mesh, null, null)).toBe('none')
  expect(partTagsState(meshOf([TRI]), tags, null)).toBe('none')
})
