import { act, renderHook } from '@testing-library/react'
import { DEFAULT_CODE, useAppStore } from '../state/store'
import { okResult } from '../test/results'
import type { RenderWorkerHandle } from './createRenderWorker'
import type { RenderRequest } from './types'
import { buildRenderRequest, useRenderLoop } from './useRenderLoop'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

function instantWorker() {
  const requests: RenderRequest[] = []
  const handle: RenderWorkerHandle = {
    render: async (req) => {
      requests.push(req)
      return okResult()
    },
    terminate: vi.fn(),
  }
  return { requests, createWorker: () => handle, handle }
}

it('renders the initial code immediately, then re-renders after debounced edits', async () => {
  const { requests, createWorker } = instantWorker()
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))

  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(requests).toEqual([{ code: DEFAULT_CODE }])
  expect(useAppStore.getState().status).toBe('ok')

  act(() => useAppStore.getState().setCode('cube(1);'))
  await act(() => vi.advanceTimersByTimeAsync(599))
  expect(requests).toHaveLength(1)
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(requests[1]).toEqual({ code: 'cube(1);' })
})

it('terminates the worker on unmount', async () => {
  const { createWorker, handle } = instantWorker()
  const { unmount } = renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(0))
  unmount()
  expect(handle.terminate).toHaveBeenCalled()
})

it('sends only the parameters that differ from the source defaults, and records what it rendered', async () => {
  const { requests, createWorker } = instantWorker()
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(0))

  act(() => useAppStore.getState().setParams({ width: 30, depth: 20, nope: 1 }))
  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(requests[1]).toEqual({ code: DEFAULT_CODE, params: { width: 30 } })
  expect(useAppStore.getState().renderedParams).toEqual({ width: 30, depth: 20, nope: 1 })
  expect(useAppStore.getState().lastRender?.code).toBe(DEFAULT_CODE)
})

it('re-renders at once with the libraries when they change', async () => {
  const { requests, createWorker } = instantWorker()
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(0))

  act(() => useAppStore.getState().setLibraries(['BOSL2']))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(requests[1]).toEqual({ code: DEFAULT_CODE, libraries: ['BOSL2'] })
})

it('builds requests without empty params or libraries', () => {
  expect(buildRenderRequest('w = 1; // [0:5]\ncube(w);', { w: 1 }, [])).toEqual({ code: 'w = 1; // [0:5]\ncube(w);' })
  expect(buildRenderRequest('w = 1; // [0:5]', { w: 2 }, ['MCAD'])).toEqual({
    code: 'w = 1; // [0:5]',
    params: { w: 2 },
    libraries: ['MCAD'],
  })
})
