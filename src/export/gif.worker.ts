import * as Comlink from 'comlink'
import { GifBuilder } from './gif'

let builder: GifBuilder | null = null

function current(): GifBuilder {
  if (!builder) throw new Error('The GIF encoder was not started')
  return builder
}

const api = {
  start(width: number, height: number, transparent: boolean): void {
    builder = new GifBuilder(width, height, transparent)
  },
  addFrame(rgba: Uint8ClampedArray, delayMs: number): number {
    return current().addFrame(rgba, delayMs)
  },
  finish(): Uint8Array {
    const bytes = current().finish()
    builder = null
    return Comlink.transfer(bytes, [bytes.buffer])
  },
}

export type GifWorkerApi = typeof api

Comlink.expose(api)
