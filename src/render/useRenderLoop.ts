import { useEffect } from 'react'
import { useAppStore } from '../state/store'
import { DEFAULT_DEBOUNCE_MS, DEFAULT_TIMEOUT_MS, RenderController } from './controller'
import { createRenderWorker, type WorkerFactory } from './createRenderWorker'

export function useRenderLoop(
  createWorker: WorkerFactory = createRenderWorker,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): void {
  useEffect(() => {
    const { renderStarted, renderFinished } = useAppStore.getState()
    const controller = new RenderController({
      createWorker,
      debounceMs,
      timeoutMs,
      onStart: renderStarted,
      onResult: (result, req) => renderFinished(result, req.code),
    })
    controller.request({ code: useAppStore.getState().code }, { immediate: true })
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.code !== prev.code) controller.request({ code: state.code })
    })
    return () => {
      unsubscribe()
      controller.dispose()
    }
  }, [createWorker, debounceMs, timeoutMs])
}
