import type { Mock } from 'vitest'
import { okResult } from '../test/results'
import { RenderController } from './controller'
import type { RenderRequest, RenderResult } from './types'

interface Deferred<T> {
  promise: Promise<T>
  resolve(v: T): void
  reject(e: unknown): void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface FakeWorker {
  requests: RenderRequest[]
  pending: Deferred<RenderResult>[]
  render: Mock<(req: RenderRequest) => Promise<RenderResult>>
  terminate: Mock<() => void>
}

function fakeWorkers() {
  const workers: FakeWorker[] = []
  const createWorker = vi.fn(() => {
    const w: FakeWorker = {
      requests: [],
      pending: [],
      render: vi.fn((req: RenderRequest) => {
        w.requests.push(req)
        const d = deferred<RenderResult>()
        w.pending.push(d)
        return d.promise
      }),
      terminate: vi.fn(),
    }
    workers.push(w)
    return w
  })
  return { workers, createWorker }
}

function setup(timeoutMs = 60_000) {
  const { workers, createWorker } = fakeWorkers()
  const onResult = vi.fn()
  const onStart = vi.fn()
  const controller = new RenderController({ createWorker, onResult, onStart, debounceMs: 600, timeoutMs })
  return { workers, createWorker, onResult, onStart, controller }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('debounces requests and renders only the latest code', async () => {
  const { workers, controller, onStart } = setup()
  controller.request({ code: 'a' })
  await vi.advanceTimersByTimeAsync(300)
  controller.request({ code: 'ab' })
  await vi.advanceTimersByTimeAsync(599)
  expect(workers).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(workers[0].requests).toEqual([{ code: 'ab' }])
  expect(onStart).toHaveBeenCalledTimes(1)
})

it('renders immediately when asked', async () => {
  const { workers, controller } = setup()
  controller.request({ code: 'a' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(workers[0].requests).toEqual([{ code: 'a' }])
})

it('delivers the result and reuses the worker for the next render', async () => {
  const { workers, controller, onResult, createWorker } = setup()
  controller.request({ code: 'a' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  const result = okResult()
  workers[0].pending[0].resolve(result)
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenCalledWith(result, { code: 'a' })

  controller.request({ code: 'b' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(createWorker).toHaveBeenCalledTimes(1)
  expect(workers[0].requests[1]).toEqual({ code: 'b' })
})

it('cancels the in-flight render when a newer one starts, and drops the stale result', async () => {
  const { workers, controller, onResult } = setup()
  controller.request({ code: 'old' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  controller.request({ code: 'new' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)

  expect(workers[0].terminate).toHaveBeenCalled()
  expect(workers[1].requests).toEqual([{ code: 'new' }])

  workers[0].pending[0].resolve(okResult())
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).not.toHaveBeenCalled()

  const fresh = okResult()
  workers[1].pending[0].resolve(fresh)
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenCalledExactlyOnceWith(fresh, { code: 'new' })
})

it('times out a hung render, kills the worker, and ignores its late result', async () => {
  const { workers, controller, onResult } = setup(60_000)
  controller.request({ code: 'for(i=[0:1e9]) cube(1);' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(59_999)
  expect(onResult).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)

  expect(workers[0].terminate).toHaveBeenCalled()
  expect(onResult).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ ok: false, error: 'Render timed out after 60 s' }),
    { code: 'for(i=[0:1e9]) cube(1);' },
  )

  workers[0].pending[0].resolve(okResult())
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenCalledTimes(1)
})

it('spawns a new worker for the next render after a timeout', async () => {
  const { workers, controller, onResult } = setup(1_000)
  controller.request({ code: 'hang' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(1_000)
  controller.request({ code: 'cube(1);' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(workers).toHaveLength(2)
  const result = okResult()
  workers[1].pending[0].resolve(result)
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenLastCalledWith(result, { code: 'cube(1);' })
})

it('reports a worker crash and replaces the worker', async () => {
  const { workers, controller, onResult } = setup()
  controller.request({ code: 'a' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  workers[0].pending[0].reject(new Error('worker died'))
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'Render worker crashed: worker died' }), { code: 'a' })
  expect(workers[0].terminate).toHaveBeenCalled()

  controller.request({ code: 'b' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(workers).toHaveLength(2)
})

it('dispose cancels pending debounce and terminates the worker', async () => {
  const { workers, controller } = setup()
  controller.request({ code: 'a' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  controller.request({ code: 'b' })
  controller.dispose()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(workers[0].terminate).toHaveBeenCalled()
  expect(workers[0].requests).toEqual([{ code: 'a' }])
})

it('cancels the in-flight render as soon as a newer request arrives, without waiting for the debounce', async () => {
  const { workers, controller, onResult } = setup()
  controller.request({ code: 'old' }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  controller.request({ code: 'newer' })
  expect(workers[0].terminate).toHaveBeenCalled()

  workers[0].pending[0].resolve(okResult())
  await vi.advanceTimersByTimeAsync(0)
  expect(onResult).not.toHaveBeenCalled()

  await vi.advanceTimersByTimeAsync(600)
  expect(workers[1].requests).toEqual([{ code: 'newer' }])
})

it('passes the request that is starting to onStart', async () => {
  vi.useFakeTimers()
  const onStart = vi.fn()
  const controller = new RenderController({
    createWorker: () => ({ render: () => new Promise<RenderResult>(() => {}), terminate: () => {} }),
    onResult: () => {},
    onStart,
    debounceMs: 10,
  })
  controller.request({ code: 'cube(1);', preview: { tagged: true } }, { immediate: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(onStart).toHaveBeenCalledWith({ code: 'cube(1);', preview: { tagged: true } })
  controller.dispose()
  vi.useRealTimers()
})
