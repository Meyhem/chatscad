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
  useAppStore.getState().renderFinished(result, DEFAULT_CODE)
  const s = useAppStore.getState()
  expect(s.status).toBe('ok')
  expect(s.mesh).toBe(result.ok && result.mesh)
  expect(s.stl).toBe(result.ok && result.stl)
  expect(s.renderMs).toBe(12)
  expect(s.error).toBeNull()
})

it('keeps the last good mesh when a render fails', () => {
  const good = okResult()
  useAppStore.getState().renderFinished(good, DEFAULT_CODE)
  useAppStore.getState().renderFinished(errorResult(), DEFAULT_CODE)
  const s = useAppStore.getState()
  expect(s.status).toBe('error')
  expect(s.error).toBe('OpenSCAD exited with code 1')
  expect(s.mesh).toBe(good.ok && good.mesh)
  expect(s.diagnostics).toEqual([expect.objectContaining({ line: 1 })])
})

it('clears the error after the next successful render', () => {
  useAppStore.getState().renderFinished(errorResult(), DEFAULT_CODE)
  useAppStore.getState().renderFinished(okResult(), DEFAULT_CODE)
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
    useAppStore.getState().renderFinished(okResult(), DEFAULT_CODE)
    expect(selectCanExport(useAppStore.getState())).toBe(true)
  })
  it('is false while re-rendering, so the export never mismatches the code', () => {
    useAppStore.getState().renderFinished(okResult(), DEFAULT_CODE)
    useAppStore.getState().renderStarted()
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
  it('is false while the editor holds code that has not been rendered yet (debounce window)', () => {
    useAppStore.getState().renderFinished(okResult(), DEFAULT_CODE)
    useAppStore.getState().setCode('cube([1, 1, 1]);')
    expect(useAppStore.getState().status).toBe('ok')
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
  it('is false when a late result belongs to older code than the editor holds', () => {
    useAppStore.getState().setCode('cube(3);')
    useAppStore.getState().renderFinished(okResult(), DEFAULT_CODE)
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
  it('is false when the current code failed, even with an older mesh on screen', () => {
    useAppStore.getState().renderFinished(okResult(), DEFAULT_CODE)
    useAppStore.getState().renderFinished(errorResult(), DEFAULT_CODE)
    expect(selectCanExport(useAppStore.getState())).toBe(false)
  })
})

describe('M2 additions', () => {
  it('starts on the workbench with manual code and no finished render', () => {
    const s = useAppStore.getState()
    expect(s.view).toBe('workbench')
    expect(s.codeSource).toBe('manual')
    expect(s.lastRender).toBeNull()
  })

  it('records where the code came from', () => {
    useAppStore.getState().setCode('cube(2);', 'ai')
    expect(useAppStore.getState()).toMatchObject({ code: 'cube(2);', codeSource: 'ai' })
    useAppStore.getState().setCode('cube(3);')
    expect(useAppStore.getState().codeSource).toBe('manual')
  })

  it('an unchanged setCode keeps the source (the editor echoes AI code back)', () => {
    useAppStore.getState().setCode('cube(2);', 'ai')
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)
    useAppStore.getState().setCode('cube(2);')
    unsubscribe()
    expect(useAppStore.getState().codeSource).toBe('ai')
    expect(listener).not.toHaveBeenCalled()
  })

  it('remembers the last finished render and its code, success or failure', () => {
    const ok = okResult()
    useAppStore.getState().renderFinished(ok, 'cube(1);')
    expect(useAppStore.getState().lastRender).toEqual({ code: 'cube(1);', result: ok })
    const failed = errorResult()
    useAppStore.getState().renderFinished(failed, 'cube(')
    expect(useAppStore.getState().lastRender).toEqual({ code: 'cube(', result: failed })
  })

  it('switches between the workbench and the settings page', () => {
    useAppStore.getState().setView('settings')
    expect(useAppStore.getState().view).toBe('settings')
  })
})
