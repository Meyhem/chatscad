import type { RenderWorkerHandle, WorkerFactory } from './createRenderWorker'
import { errorMessage, failedResult } from './result'
import type { RenderRequest, RenderResult } from './types'

export const DEFAULT_DEBOUNCE_MS = 600
export const DEFAULT_TIMEOUT_MS = 60_000

export interface RenderControllerOptions {
  createWorker: WorkerFactory
  /** `req` is the request that produced `result`, so callers can tell which code it belongs to. */
  onResult(result: RenderResult, req: RenderRequest): void
  /** `req` is the request that is starting (M5: tagged previews start quietly). */
  onStart?(req: RenderRequest): void
  debounceMs?: number
  timeoutMs?: number
}

export class RenderController {
  private readonly createWorker: WorkerFactory
  private readonly onResult: (result: RenderResult, req: RenderRequest) => void
  private readonly onStart: (req: RenderRequest) => void
  private readonly debounceMs: number
  private readonly timeoutMs: number

  private worker: RenderWorkerHandle | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private currentId = 0
  private inFlight = false

  constructor(opts: RenderControllerOptions) {
    this.createWorker = opts.createWorker
    this.onResult = opts.onResult
    this.onStart = opts.onStart ?? (() => {})
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  request(req: RenderRequest, { immediate = false }: { immediate?: boolean } = {}): void {
    this.clearDebounce()
    // A newer request cancels the in-flight one at once, so a result for superseded code is never delivered.
    if (this.inFlight) {
      this.killWorker()
      this.settle()
      this.currentId++
    }
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = null
        this.start(req)
      },
      immediate ? 0 : this.debounceMs,
    )
  }

  cancel(): void {
    this.clearDebounce()
    if (this.inFlight) this.killWorker()
    this.settle()
    this.currentId++
  }

  dispose(): void {
    this.cancel()
    this.killWorker()
  }

  private start(req: RenderRequest): void {
    if (this.inFlight) this.killWorker()
    this.settle()
    const id = ++this.currentId
    this.inFlight = true
    this.onStart(req)

    const worker = (this.worker ??= this.createWorker())
    const startedAt = performance.now()
    let done = false
    const deliver = (result: RenderResult, kill: boolean) => {
      if (done || id !== this.currentId) return
      done = true
      this.settle()
      if (kill) this.killWorker()
      this.onResult(result, req)
    }

    this.timeoutTimer = setTimeout(
      () => deliver(failedResult(`Render timed out after ${Math.round(this.timeoutMs / 1000)} s`, { renderMs: this.timeoutMs }), true),
      this.timeoutMs,
    )
    worker.render(req).then(
      (result) => deliver(result, false),
      (err: unknown) =>
        deliver(failedResult(`Render worker crashed: ${errorMessage(err)}`, { renderMs: performance.now() - startedAt }), true),
    )
  }

  private settle(): void {
    this.inFlight = false
    if (this.timeoutTimer !== null) clearTimeout(this.timeoutTimer)
    this.timeoutTimer = null
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
  }

  private killWorker(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
