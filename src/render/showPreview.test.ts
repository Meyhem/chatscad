import { selectDisplayMesh, selectShowingPreview, useAppStore } from '../state/store'
import { STARTER_CODE as DEFAULT_CODE } from '../test/fixtures'
import { okResult } from '../test/results'
import { showPreviewIfCurrent } from './showPreview'
import { buildRenderRequest } from './useRenderLoop'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

const meshOf = () => {
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  return r.mesh
}

it('shows the preview when the store holds parameters equal to the source defaults', () => {
  // A slider dragged away and back: the store holds width = 20, the request carries no override.
  useAppStore.setState({ code: DEFAULT_CODE, params: { width: 20 }, status: 'rendering' })
  const mesh = meshOf()
  showPreviewIfCurrent(buildRenderRequest(DEFAULT_CODE, { width: 20 }, []), mesh)
  expect(selectDisplayMesh(useAppStore.getState())).toBe(mesh)
  expect(selectShowingPreview(useAppStore.getState())).toBe(true)
})

it('drops a preview for code or parameters the person has already changed', () => {
  useAppStore.setState({ code: DEFAULT_CODE, params: { width: 30 }, status: 'rendering' })
  showPreviewIfCurrent(buildRenderRequest(DEFAULT_CODE, { width: 25 }, []), meshOf())
  expect(selectShowingPreview(useAppStore.getState())).toBe(false)
  showPreviewIfCurrent(buildRenderRequest('cube(1);', {}, []), meshOf())
  expect(selectShowingPreview(useAppStore.getState())).toBe(false)
})
