import type { WorkerFactory } from './createRenderWorker'
import type { RenderRequest, RenderResult } from './types'

export const LOW_QUALITY_FN = 12

export interface PreviewPassOptions {
  enabled(): boolean
  onPreview(result: Extract<RenderResult, { ok: true }>, req: RenderRequest): void
}

/**
 * Wraps a worker so each render first compiles with `$fn = 12` (shown at once on slow phones), then in full.
 * The caller only ever receives the full result, so exports and awaitRender never see the quick mesh.
 */
export function withPreviewPass(createWorker: WorkerFactory, opts: PreviewPassOptions): WorkerFactory {
  return () => {
    const inner = createWorker()
    let terminated = false
    return {
      async render(req) {
        if (opts.enabled()) {
          const quick = await inner.render({ ...req, params: { ...req.params, $fn: LOW_QUALITY_FN } })
          // A newer request made the controller kill this worker; its result is never delivered.
          if (terminated) return quick
          if (quick.ok) opts.onPreview(quick, req)
        }
        return inner.render(req)
      },
      terminate() {
        terminated = true
        inner.terminate()
      },
    }
  }
}
