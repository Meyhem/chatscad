import { useAppStore } from './store'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('keeps the OpenSCAD download progress', () => {
  expect(useAppStore.getState().loadProgress).toBeNull()
  useAppStore.getState().setLoadProgress({ loaded: 1_000, total: 11_000_303 })
  expect(useAppStore.getState().loadProgress).toEqual({ loaded: 1_000, total: 11_000_303 })
})

import { okResult } from '../test/results'
import { selectCanExport, selectDisplayMesh, selectShowingPreview } from './store'

function meshOf(r = okResult()) {
  if (!r.ok) throw new Error('fixture must succeed')
  return r.mesh
}

it('shows the quick preview only while the matching code and parameters render', () => {
  const full = meshOf()
  const quick = meshOf()
  useAppStore.setState({ code: 'cube(1);', params: { w: 2 }, mesh: full, status: 'rendering' })
  useAppStore.getState().showPreview({ code: 'cube(1);', params: { w: 2 }, mesh: quick })
  expect(selectDisplayMesh(useAppStore.getState())).toBe(quick)
  expect(selectShowingPreview(useAppStore.getState())).toBe(true)

  useAppStore.setState({ params: { w: 3 } })
  expect(selectDisplayMesh(useAppStore.getState())).toBe(full)
  useAppStore.setState({ params: { w: 2 }, code: 'cube(2);' })
  expect(selectDisplayMesh(useAppStore.getState())).toBe(full)
  useAppStore.setState({ code: 'cube(1);', status: 'ok' })
  expect(selectDisplayMesh(useAppStore.getState())).toBe(full)
  expect(selectShowingPreview(useAppStore.getState())).toBe(false)
})

it('never makes the quick preview exportable or visible to awaitRender', () => {
  useAppStore.setState({ code: 'cube(1);', status: 'rendering', renderedCode: 'cube(0);' })
  useAppStore.getState().showPreview({ code: 'cube(1);', params: {}, mesh: meshOf() })
  expect(selectCanExport(useAppStore.getState())).toBe(false)
  expect(useAppStore.getState().lastRender).toBeNull()
  expect(useAppStore.getState().renderedCode).toBe('cube(0);')
})
