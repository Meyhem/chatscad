import { useAppStore } from './store'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('keeps the OpenSCAD download progress', () => {
  expect(useAppStore.getState().loadProgress).toBeNull()
  useAppStore.getState().setLoadProgress({ loaded: 1_000, total: 11_000_303 })
  expect(useAppStore.getState().loadProgress).toEqual({ loaded: 1_000, total: 11_000_303 })
})
