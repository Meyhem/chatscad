import { renderHook, waitFor } from '@testing-library/react'
import type { RenderWorkerHandle } from '../render/createRenderWorker'
import type { RenderRequest } from '../render/types'
import { makeVersion } from '../test/fixtures'
import { errorResult, okResult } from '../test/results'
import { usePreviewRender } from './usePreviewRender'

it('renders the previewed version in its own worker, clears the old mesh on a new version, and disposes the worker', async () => {
  const requests: RenderRequest[] = []
  const handle: RenderWorkerHandle = {
    render: async (req) => {
      requests.push(req)
      return req.code.includes('broken') ? errorResult() : okResult()
    },
    terminate: vi.fn(),
  }
  const createWorker = vi.fn(() => handle)
  const a = makeVersion({ id: 'a', code: 'w = 1; // [0:9]\ncube(w);', params: { w: 5 } })
  const b = makeVersion({ id: 'b', code: 'broken(' })
  const { result, rerender, unmount } = renderHook(({ version }) => usePreviewRender(createWorker, version, ['MCAD']), {
    initialProps: { version: a },
  })
  await waitFor(() => expect(result.current.status).toBe('ok'))
  expect(result.current.mesh).not.toBeNull()
  expect(requests[0]).toEqual({ code: a.code, params: { w: 5 }, libraries: ['MCAD'] })

  rerender({ version: b })
  expect(result.current.mesh).toBeNull()
  await waitFor(() => expect(result.current).toMatchObject({ status: 'error', error: 'OpenSCAD exited with code 1' }))

  unmount()
  expect(handle.terminate).toHaveBeenCalled()
  expect(createWorker).toHaveBeenCalledTimes(1)
})
