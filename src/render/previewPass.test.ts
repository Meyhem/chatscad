import type { Mock } from 'vitest'
import { errorResult, okResult } from '../test/results'
import { LOW_QUALITY_FN, withPreviewPass } from './previewPass'
import type { RenderRequest, RenderResult } from './types'

interface FakeHandle {
  requests: RenderRequest[]
  render: Mock<(req: RenderRequest) => Promise<RenderResult>>
  terminate: Mock<() => void>
}

function fakeFactory(respond: (req: RenderRequest) => RenderResult | Promise<RenderResult>) {
  const handles: FakeHandle[] = []
  const factory = vi.fn(() => {
    const h: FakeHandle = {
      requests: [],
      render: vi.fn(async (req: RenderRequest) => {
        h.requests.push(req)
        return respond(req)
      }),
      terminate: vi.fn(),
    }
    handles.push(h)
    return h
  })
  return { handles, factory }
}

it('renders with $fn = 12 first, reports that mesh, then returns the full render', async () => {
  const quick = okResult()
  const full = okResult()
  const { handles, factory } = fakeFactory((req) => (req.params?.$fn === LOW_QUALITY_FN ? quick : full))
  const onPreview = vi.fn()
  const worker = withPreviewPass(factory, { enabled: () => true, onPreview })()

  await expect(worker.render({ code: 'c', params: { w: 2 } })).resolves.toBe(full)
  expect(handles[0].requests).toEqual([
    { code: 'c', params: { w: 2, $fn: 12 } },
    { code: 'c', params: { w: 2 } },
  ])
  expect(onPreview).toHaveBeenCalledExactlyOnceWith(quick, { code: 'c', params: { w: 2 } })
})

it('renders once when the setting is off', async () => {
  const { handles, factory } = fakeFactory(() => okResult())
  const onPreview = vi.fn()
  await withPreviewPass(factory, { enabled: () => false, onPreview })().render({ code: 'c' })
  expect(handles[0].requests).toEqual([{ code: 'c' }])
  expect(onPreview).not.toHaveBeenCalled()
})

it('does not report a failed quick pass and still renders in full', async () => {
  const full = okResult()
  const { handles, factory } = fakeFactory((req) => (req.params?.$fn === LOW_QUALITY_FN ? errorResult() : full))
  const onPreview = vi.fn()
  await expect(withPreviewPass(factory, { enabled: () => true, onPreview })().render({ code: 'c' })).resolves.toBe(full)
  expect(onPreview).not.toHaveBeenCalled()
  expect(handles[0].requests).toHaveLength(2)
})

it('drops the quick mesh and skips the full pass once the controller has terminated the worker', async () => {
  let release!: (r: RenderResult) => void
  const { handles, factory } = fakeFactory(() => new Promise<RenderResult>((resolve) => (release = resolve)))
  const onPreview = vi.fn()
  const worker = withPreviewPass(factory, { enabled: () => true, onPreview })()
  const pending = worker.render({ code: 'old' })
  await vi.waitFor(() => expect(handles[0].requests).toHaveLength(1))
  worker.terminate()
  release(okResult())
  await pending
  expect(onPreview).not.toHaveBeenCalled()
  expect(handles[0].requests).toHaveLength(1)
  expect(handles[0].terminate).toHaveBeenCalled()
})

it('skips the quick pass for the click-to-refine tagged preview', async () => {
  const { handles, factory } = fakeFactory(() => okResult())
  const onPreview = vi.fn()
  const worker = withPreviewPass(factory, { enabled: () => true, onPreview })()
  await worker.render({ code: 'cube(1);', preview: { tagged: true } })
  expect(handles[0].requests).toEqual([{ code: 'cube(1);', preview: { tagged: true } }])
  expect(onPreview).not.toHaveBeenCalled()
})
