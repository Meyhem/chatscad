import { useEffect, useRef, useState } from 'react'
import type { Version } from '../db/db'
import { RenderController } from '../render/controller'
import type { WorkerFactory } from '../render/createRenderWorker'
import type { MeshData } from '../render/types'
import { buildRenderRequest } from '../render/useRenderLoop'

export interface PreviewState {
  status: 'idle' | 'rendering' | 'ok' | 'error'
  mesh: MeshData | null
  renderMs: number | null
  error: string | null
}

const IDLE: PreviewState = { status: 'idle', mesh: null, renderMs: null, error: null }

/** A second RenderController with its own worker, so previews never disturb the workbench render. */
export function usePreviewRender(createWorker: WorkerFactory, version: Version | null, libraries: string[]): PreviewState {
  const [state, setState] = useState<PreviewState>(IDLE)
  const controllerRef = useRef<RenderController | null>(null)

  useEffect(() => {
    const controller = new RenderController({
      createWorker,
      debounceMs: 0,
      onStart: () => setState((s) => ({ ...s, status: 'rendering' })),
      onResult: (r) =>
        setState(r.ok ? { status: 'ok', mesh: r.mesh, renderMs: r.renderMs, error: null } : { status: 'error', mesh: null, renderMs: r.renderMs, error: r.error }),
    })
    controllerRef.current = controller
    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [createWorker])

  const key = libraries.join(',')
  useEffect(() => {
    setState({ ...IDLE, status: version ? 'rendering' : 'idle' })
    if (version) controllerRef.current?.request(buildRenderRequest(version.code, version.params, key ? key.split(',') : []), { immediate: true })
  }, [version, key])

  return state
}
