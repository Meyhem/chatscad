import { abortError } from '../util/abort'
import { DEFAULT_TIMEOUT_MS } from './controller'
import type { RenderWorkerHandle, WorkerFactory } from './createRenderWorker'
import { errorMessage, failedResult } from './result'
import type { RenderRequest, RenderResult } from './types'

interface Job {
  req: RenderRequest
  resolve(result: RenderResult): void
  reject(e: unknown): void
  detach(): void
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Background renders (variants, timelapse frames) on their own worker, so they never disturb the main view.
 * FIFO, one job at a time, same timeout and respawn rules as RenderController, no debounce, no cancel-on-newer.
 */
export class RenderQueue {
  private readonly createWorker: WorkerFactory
  private readonly timeoutMs: number
  private worker: RenderWorkerHandle | null = null
  private readonly waiting: Job[] = []
  private current: Job | null = null
  private disposed = false

  constructor(opts: { createWorker: WorkerFactory; timeoutMs?: number }) {
    this.createWorker = opts.createWorker
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  render(req: RenderRequest, signal?: AbortSignal): Promise<RenderResult> {
    if (this.disposed) return Promise.reject(abortError('The render queue was closed'))
    if (signal?.aborted) return Promise.reject(abortError('Render cancelled'))
    return new Promise<RenderResult>((resolve, reject) => {
      const job: Job = { req, resolve, reject, detach: () => {}, timer: null }
      if (signal) {
        const onAbort = () => this.abort(job)
        signal.addEventListener('abort', onAbort, { once: true })
        job.detach = () => signal.removeEventListener('abort', onAbort)
      }
      this.waiting.push(job)
      this.pump()
    })
  }

  dispose(): void {
    this.disposed = true
    const jobs = [...(this.current ? [this.current] : []), ...this.waiting]
    this.waiting.length = 0
    this.current = null
    this.killWorker()
    for (const job of jobs) this.fail(job, abortError('The render queue was closed'))
  }

  private abort(job: Job): void {
    const index = this.waiting.indexOf(job)
    if (index >= 0) {
      this.waiting.splice(index, 1)
      this.fail(job, abortError('Render cancelled'))
      return
    }
    if (this.current === job) {
      this.current = null
      this.killWorker()
      this.fail(job, abortError('Render cancelled'))
      this.pump()
    }
  }

  private pump(): void {
    if (this.current || this.disposed) return
    const job = this.waiting.shift()
    if (!job) return
    this.current = job
    const worker = (this.worker ??= this.createWorker())
    const startedAt = performance.now()

    const deliver = (result: RenderResult, kill: boolean) => {
      if (this.current !== job) return
      this.current = null
      if (job.timer !== null) clearTimeout(job.timer)
      if (kill) this.killWorker()
      job.detach()
      job.resolve(result)
      this.pump()
    }

    job.timer = setTimeout(
      () => deliver(failedResult(`Render timed out after ${Math.round(this.timeoutMs / 1000)} s`, { renderMs: this.timeoutMs }), true),
      this.timeoutMs,
    )
    worker.render(job.req).then(
      (result) => deliver(result, false),
      (err: unknown) =>
        deliver(failedResult(`Render worker crashed: ${errorMessage(err)}`, { renderMs: performance.now() - startedAt }), true),
    )
  }

  private fail(job: Job, e: DOMException): void {
    if (job.timer !== null) clearTimeout(job.timer)
    job.detach()
    job.reject(e)
  }

  private killWorker(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
