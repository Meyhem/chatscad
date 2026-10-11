import * as Comlink from 'comlink'
import type { GifWorkerApi } from './gif.worker'

export interface GifEncoderHandle {
  /** Resolves with the GIF's size so far in bytes. */
  addFrame(frame: ImageData, delayMs: number): Promise<number>
  finish(): Promise<Blob>
  terminate(): void
}

/** Quantising and LZW-compressing frames runs in a module worker so the dialog stays responsive. */
export async function createGifEncoder(width: number, height: number, transparent: boolean): Promise<GifEncoderHandle> {
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' })
  const api = Comlink.wrap<GifWorkerApi>(worker)
  await api.start(width, height, transparent)
  return {
    addFrame: (frame, delayMs) => api.addFrame(frame.data, delayMs),
    finish: async () => new Blob([new Uint8Array(await api.finish())], { type: 'image/gif' }),
    terminate: () => {
      api[Comlink.releaseProxy]()
      worker.terminate()
    },
  }
}
