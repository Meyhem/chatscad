import { errorResult, okResult } from '../test/results'
import { DEFAULT_CODE, selectCanExport, useAppStore } from './store'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('starts idle with the default model code', () => {
  const s = useAppStore.getState()
  expect(s.code).toBe(DEFAULT_CODE)
  expect(s.status).toBe('idle')
  expect(s.mesh).toBeNull()
  expect(s.reveal).toBeNull()
})

it('stores mesh, STL, logs and timing on success', () => {
  const result = okResult()
  useAppStore.getState().renderStarted()
  expect(useAppStore.getState().status).toBe('rendering')
  useAppStore.getState().renderFinished(result)
  const s = useAppStore.getState()
  expect(s.status).toBe('ok')
  expect(s.mesh).toBe(result.ok && result.mesh)
  expect(s.stl).toBe(result.ok && result.stl)
  expect(s.renderMs).toBe(12)
  expect(s.error).toBeNull()
})

it('keeps the last good mesh when a render fails', () => {
  const good = okResult()
  useAppStore.getState().renderFinished(good)
  useAppStore.getState().renderFinished(errorResult())
  const s = useAppStore.getState()
  expect(s.status).toBe('error')
  expect(s.error).toBe('OpenSCAD exited with code 1')
  expect(s.mesh).toBe(good.ok && good.mesh)
  expect(s.diagnostics).toEqual([expect.objectContaining({ line: 1 })])
})

it('clears the error after the next successful render', () => {
  useAppStore.getState().renderFinished(errorResult())
  useAppStore.getState().renderFinished(okResult())
  expect(useAppStore.getState().error).toBeNull()
})

it('issues a new reveal request each time a line is asked for, even the same line', () => {
  useAppStore.getState().goToLine(7)
  const first = useAppStore.getState().reveal
  useAppStore.getState().goToLine(7)
  const second = useAppStore.getState().reveal
  expect(first).toEqual({ line: 7, id: expect.any(Number) })
  expect(second?.line).toBe(7)
  expect(second?.id).not.toBe(first?.id)
})

describe('selectCanExport', () => {
  it('is false before any render', () => {
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
  it('is true after a successful render', () => {
    useAppStore.getState().renderFinished(okResult())
    expect(selectCanExport(useAppStore.getState())).toBe(true)
  })
  it('is false while re-rendering, so the export never mismatches the code', () => {
    useAppStore.getState().renderFinished(okResult())
    useAppStore.getState().renderStarted()
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
  it('is false when the current code failed, even with an older mesh on screen', () => {
    useAppStore.getState().renderFinished(okResult())
    useAppStore.getState().renderFinished(errorResult())
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
})
