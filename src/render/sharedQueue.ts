import { createRenderWorker } from './createRenderWorker'
import { RenderQueue } from './queue'

let queue: RenderQueue | null = null

/** The app's one background queue; variants and timelapse frames share it so they render one by one. */
export function getRenderQueue(): RenderQueue {
  return (queue ??= new RenderQueue({ createWorker: createRenderWorker }))
}
