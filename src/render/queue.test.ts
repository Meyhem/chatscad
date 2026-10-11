import type { Mock } from 'vitest'
import { errorResult, okResult } from '../test/results'
import { RenderQueue } from './queue'
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

function setup(timeoutMs = 60_000) {
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
  return { workers, createWorker, queue: new RenderQueue({ createWorker, timeoutMs }) }
}

const settled = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('renders jobs one at a time in the order they were queued, on one worker', async () => {
  const { workers, createWorker, queue } = setup()
  const a = queue.render({ code: 'a' })
  const b = queue.render({ code: 'b' })
  await settled()
  expect(workers[0].requests).toEqual([{ code: 'a' }])

  const first = okResult()
  workers[0].pending[0].resolve(first)
  await expect(a).resolves.toBe(first)
  await settled()
  expect(workers[0].requests).toEqual([{ code: 'a' }, { code: 'b' }])

  const second = errorResult()
  workers[0].pending[1].resolve(second)
  await expect(b).resolves.toBe(second)
  expect(createWorker).toHaveBeenCalledTimes(1)
})

it('starts at once without a debounce', async () => {
  const { workers, queue } = setup()
  void queue.render({ code: 'a' })
  await settled()
  expect(workers[0].render).toHaveBeenCalledTimes(1)
})

it('times out a hung job, kills the worker, and runs the next job on a new worker', async () => {
  const { workers, queue } = setup(1_000)
  const hung = queue.render({ code: 'for(i=[0:1e9]) cube(1);' })
  const next = queue.render({ code: 'cube(1);' })
  await vi.advanceTimersByTimeAsync(1_000)

  await expect(hung).resolves.toMatchObject({ ok: false, error: 'Render timed out after 1 s' })
  expect(workers[0].terminate).toHaveBeenCalled()
  await settled()
  expect(workers[1].requests).toEqual([{ code: 'cube(1);' }])

  workers[0].pending[0].resolve(okResult())
  const fresh = okResult()
  workers[1].pending[0].resolve(fresh)
  await expect(next).resolves.toBe(fresh)
})

it('reports a crash as a failed result and replaces the worker', async () => {
  const { workers, queue } = setup()
  const crashed = queue.render({ code: 'a' })
  await settled()
  workers[0].pending[0].reject(new Error('worker died'))
  await expect(crashed).resolves.toMatchObject({ ok: false, error: 'Render worker crashed: worker died' })
  expect(workers[0].terminate).toHaveBeenCalled()
  void queue.render({ code: 'b' })
  await settled()
  expect(workers).toHaveLength(2)
})

it('drops an aborted queued job without sending it to the worker', async () => {
  const { workers, queue } = setup()
  void queue.render({ code: 'a' })
  const controller = new AbortController()
  const b = queue.render({ code: 'b' }, controller.signal)
  controller.abort()
  await expect(b).rejects.toMatchObject({ name: 'AbortError' })
  workers[0].pending[0].resolve(okResult())
  await settled()
  expect(workers[0].requests).toEqual([{ code: 'a' }])
})

it('kills the worker for an aborted in-flight job and moves on', async () => {
  const { workers, queue } = setup()
  const controller = new AbortController()
  const a = queue.render({ code: 'a' }, controller.signal)
  const b = queue.render({ code: 'b' })
  await settled()
  controller.abort()
  await expect(a).rejects.toMatchObject({ name: 'AbortError' })
  expect(workers[0].terminate).toHaveBeenCalled()
  await settled()
  expect(workers[1].requests).toEqual([{ code: 'b' }])
  const result = okResult()
  workers[1].pending[0].resolve(result)
  await expect(b).resolves.toBe(result)
})

it('rejects a job whose signal is already aborted', async () => {
  const { queue, createWorker } = setup()
  await expect(queue.render({ code: 'a' }, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  expect(createWorker).not.toHaveBeenCalled()
})

it('dispose rejects every job, terminates the worker, and refuses new work', async () => {
  const { workers, queue } = setup()
  const a = queue.render({ code: 'a' })
  const b = queue.render({ code: 'b' })
  await settled()
  queue.dispose()
  await expect(a).rejects.toMatchObject({ name: 'AbortError' })
  await expect(b).rejects.toMatchObject({ name: 'AbortError' })
  expect(workers[0].terminate).toHaveBeenCalled()
  await expect(queue.render({ code: 'c' })).rejects.toMatchObject({ name: 'AbortError' })
})
