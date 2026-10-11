import * as Comlink from 'comlink'
import { emitLoadProgress, isLoadProgressMessage } from './loadProgress'
import type { RenderWorkerApi } from './render.worker'
import type { RenderRequest, RenderResult } from './types'

export interface RenderWorkerHandle {
  render(req: RenderRequest): Promise<RenderResult>
  terminate(): void
}

export type WorkerFactory = () => RenderWorkerHandle

export function createRenderWorker(): RenderWorkerHandle {
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
  // Download progress travels beside Comlink's messages; Comlink ignores anything without its own id.
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isLoadProgressMessage(event.data)) emitLoadProgress({ loaded: event.data.loaded, total: event.data.total })
  })
  const api = Comlink.wrap<RenderWorkerApi>(worker)
  return {
    render: (req) => api.render(req),
    terminate: () => {
      api[Comlink.releaseProxy]()
      worker.terminate()
    },
  }
}
