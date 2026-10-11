import { useEffect } from 'react'
import { paramOverrides } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { DEFAULT_DEBOUNCE_MS, DEFAULT_TIMEOUT_MS, RenderController } from './controller'
import { createRenderWorker, type WorkerFactory } from './createRenderWorker'
import type { Params } from './params'
import type { RenderRequest } from './types'

/** Only parameters that differ from the source defaults become -D overrides; empty fields are omitted. */
export function buildRenderRequest(code: string, params: Params, libraries: string[]): RenderRequest {
  const overrides = paramOverrides(code, params)
  return {
    code,
    ...(Object.keys(overrides).length > 0 ? { params: overrides } : {}),
    ...(libraries.length > 0 ? { libraries } : {}),
  }
}

export function useRenderLoop(
  createWorker: WorkerFactory = createRenderWorker,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): void {
  useEffect(() => {
    const { renderStarted, renderFinished } = useAppStore.getState()
    // The store params each request was built from, so the result records exactly what it rendered.
    const paramsOf = new WeakMap<RenderRequest, Params>()
    const controller = new RenderController({
      createWorker,
      debounceMs,
      timeoutMs,
      onStart: renderStarted,
      onResult: (result, req) => renderFinished(result, req.code, paramsOf.get(req) ?? {}),
    })
    const send = (immediate: boolean) => {
      const { code, params, libraries } = useAppStore.getState()
      const req = buildRenderRequest(code, params, libraries)
      paramsOf.set(req, params)
      controller.request(req, { immediate })
    }
    send(true)
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.code !== prev.code || state.params !== prev.params) send(false)
      else if (state.libraries !== prev.libraries) send(true)
    })
    return () => {
      unsubscribe()
      controller.dispose()
    }
  }, [createWorker, debounceMs, timeoutMs])
}
