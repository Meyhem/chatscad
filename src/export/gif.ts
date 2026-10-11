import { applyPalette, GIFEncoder, quantize, type Format, type GifStream } from 'gifenc'

/** Builds a looping GIF frame by frame; each frame gets its own 256-colour palette. */
export class GifBuilder {
  private readonly gif: GifStream = GIFEncoder()
  private frames = 0
  private readonly width: number
  private readonly height: number
  private readonly transparent: boolean

  constructor(width: number, height: number, transparent: boolean) {
    this.width = width
    this.height = height
    this.transparent = transparent
  }

  /** Adds one frame and returns the GIF's size so far in bytes. */
  addFrame(rgba: Uint8ClampedArray, delayMs: number): number {
    const pixels = this.width * this.height
    if (rgba.length !== pixels * 4) {
      throw new Error(`Frame has ${rgba.length / 4} pixels, expected ${this.width} × ${this.height}`)
    }
    const format: Format = this.transparent ? 'rgba4444' : 'rgb565'
    const palette = quantize(rgba, 256, this.transparent ? { format, oneBitAlpha: true } : { format })
    const index = applyPalette(rgba, palette, format)
    const transparentIndex = this.transparent ? palette.findIndex((c) => c[3] === 0) : -1
    this.gif.writeFrame(index, this.width, this.height, {
      palette,
      delay: delayMs,
      repeat: 0,
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    })
    this.frames++
    return this.gif.bytesView().length
  }

  finish(): Uint8Array {
    if (this.frames === 0) throw new Error('Add at least one frame before finishing the GIF')
    this.gif.finish()
    return this.gif.bytes()
  }
}
