import { useAppStore, type AppState } from '../state/store'
import type { RenderResult } from './types'

const abortError = () => new DOMException('Stopped waiting for the render', 'AbortError')

function resultFor(state: AppState, code: string): RenderResult | null {
  return state.lastRender !== null && state.lastRender.code === code ? state.lastRender.result : null
}

/** Resolves with the first finished render of exactly `code` (including one already present). */
export function awaitRender(code: string, signal?: AbortSignal): Promise<RenderResult> {
  return new Promise<RenderResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const present = resultFor(useAppStore.getState(), code)
    if (present) {
      resolve(present)
      return
    }
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    const unsubscribe = useAppStore.subscribe((state) => {
      const result = resultFor(state, code)
      if (result) {
        cleanup()
        resolve(result)
      }
    })
    function cleanup() {
      unsubscribe()
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
