import { act, renderHook } from '@testing-library/react'
import type { RenderWorkerHandle } from '../render/createRenderWorker'
import type { RenderRequest, RenderResult } from '../render/types'
import { useRenderLoop } from '../render/useRenderLoop'
import { useAppStore } from '../state/store'
import { okResult } from '../test/results'
import { useRefineStore } from './refineStore'

const TWO_PARTS = 'cube(10);\ntranslate([20, 0, 0]) cube(5);\n'

function taggedResult(): RenderResult {
  const base = okResult()
  if (!base.ok) throw new Error('fixture')
  return { ...base, stl: new ArrayBuffer(0), mesh: { ...base.mesh, faceTags: Uint32Array.from([2]) } }
}

function scriptedWorker(tagged: () => Promise<RenderResult> = async () => taggedResult()) {
  const requests: RenderRequest[] = []
  const handle: RenderWorkerHandle = {
    render: async (req) => {
      requests.push(req)
      return req.preview ? tagged() : okResult()
    },
    terminate: vi.fn(),
  }
  return { requests, handle, createWorker: () => handle }
}

beforeEach(() => {
  useAppStore.setState({ ...useAppStore.getInitialState(), code: TWO_PARTS }, true)
  useRefineStore.setState(useRefineStore.getInitialState(), true)
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

it('follows a successful render with a quiet tagged preview of the same request', async () => {
  const { requests, createWorker } = scriptedWorker()
  const statuses: string[] = []
  const unsubscribe = useAppStore.subscribe((s, prev) => {
    if (s.status !== prev.status) statuses.push(s.status)
  })
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  unsubscribe()

  expect(requests).toMatchObject([{ code: TWO_PARTS }, { code: TWO_PARTS, preview: { tagged: true } }])
  expect(requests[0].preview).toBeUndefined()
  const app = useAppStore.getState()
  expect(statuses).toEqual(['rendering', 'ok'])
  expect(app.stl?.byteLength).toBe(134)
  const tags = useRefineStore.getState().tags
  expect(tags?.baseMesh).toBe(app.mesh)
  expect(Array.from(tags?.mesh.faceTags ?? [])).toEqual([2])
})

it('skips the follow-up for a single-part model', async () => {
  useAppStore.setState({ code: 'cube(10);\n' })
  const { requests, createWorker } = scriptedWorker()
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(requests).toHaveLength(1)
  expect(useRefineStore.getState().tags?.statements).toHaveLength(1)
})

it('an edit cancels an in-flight tagged preview', async () => {
  const { handle, createWorker } = scriptedWorker(() => new Promise<RenderResult>(() => {}))
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(useRefineStore.getState().pendingBase).not.toBeNull()

  act(() => useAppStore.getState().setCode('cube(3);\n'))
  expect(handle.terminate).toHaveBeenCalled()
  expect(useRefineStore.getState().tags).toBeNull()
})

it('a failed tagged preview leaves the app as it was and no tags', async () => {
  const { createWorker } = scriptedWorker(async () => ({ ...okResult(), ok: false, error: 'boom' }) as RenderResult)
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(useAppStore.getState().status).toBe('ok')
  expect(useAppStore.getState().error).toBeNull()
  expect(useRefineStore.getState().tags).toBeNull()
})

it('runs tagged previews on their own worker, so an edit during one never restarts the main worker', async () => {
  const handles: Array<{ render: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }> = []
  const createWorker = () => {
    const handle = {
      render: vi.fn(async (req: RenderRequest) => (req.preview ? new Promise<RenderResult>(() => {}) : okResult())),
      terminate: vi.fn(),
    }
    handles.push(handle)
    return handle
  }
  renderHook(() => useRenderLoop(createWorker, 600, 60_000))
  await act(() => vi.advanceTimersByTimeAsync(10))
  const main = handles.find((h) => h.render.mock.calls.some(([r]) => !(r as RenderRequest).preview))!
  expect(handles.some((h) => h !== main && h.render.mock.calls.some(([r]) => (r as RenderRequest).preview))).toBe(true)
  expect(useRefineStore.getState().pendingBase).not.toBeNull()

  act(() => useAppStore.getState().setCode(`${TWO_PARTS}// edited\n`))
  expect(useRefineStore.getState().pendingBase).toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(main.terminate).not.toHaveBeenCalled()
  expect(main.render).toHaveBeenCalledTimes(2)
})
