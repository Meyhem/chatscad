import { okResult } from '../test/results'
import { turntablePoses, type CameraPose } from './frames'
import { clampFrames, exportTurntable, formatGifProgress, turntableDelayMs, type FrameDeps, type GifProgress } from './turntable'

vi.mock('../theme/tokens', () => ({ readToken: (name: string) => `token:${name}` }))

const result = okResult()
if (!result.ok) throw new Error('fixture must succeed')
const mesh = result.mesh

function fakes() {
  const delays: number[] = []
  const encoder = {
    addFrame: vi.fn(async (_frame: ImageData, delay: number) => {
      delays.push(delay)
      return delays.length * 1_000
    }),
    finish: vi.fn(async () => new Blob(['GIF89a'], { type: 'image/gif' })),
    terminate: vi.fn(),
  }
  const renderFrames = vi.fn(async function* (opts: { size: [number, number]; background: string | null; cameras: CameraPose[] }) {
    for (let i = 0; i < opts.cameras.length; i++) {
      yield { width: opts.size[0], height: opts.size[1], data: new Uint8ClampedArray(4) } as unknown as ImageData
    }
  })
  const createEncoder = vi.fn(async () => encoder)
  return { delays, encoder, renderFrames, createEncoder, deps: { renderFrames, createEncoder } as unknown as FrameDeps }
}

it('keeps the frame count between 36 and 72', () => {
  expect(clampFrames(10)).toBe(36)
  expect(clampFrames(100)).toBe(72)
  expect(clampFrames(48.4)).toBe(48)
  expect(clampFrames(Number.NaN)).toBe(48)
})

it('spins once in about 4 s, in whole hundredths of a second', () => {
  expect(turntableDelayMs(36)).toBe(110)
  expect(turntableDelayMs(48)).toBe(80)
  expect(turntableDelayMs(72)).toBe(60)
})

it('estimates the final size from the frames so far', () => {
  expect(formatGifProgress({ done: 4, total: 6, bytes: 1_066_667 })).toBe('Rendering frames · 4 of 6 · about 1.6 MB')
  expect(formatGifProgress({ done: 0, total: 6, bytes: 0 })).toBe('Rendering frames · 0 of 6')
})

it('renders one turn on a transparent ground and encodes every frame', async () => {
  const f = fakes()
  const progress: GifProgress[] = []
  const blob = await exportTurntable(
    { mesh, size: [480, 480], frames: 100, transparent: true, signal: new AbortController().signal, onProgress: (p) => progress.push(p) },
    f.deps,
  )
  expect(blob.type).toBe('image/gif')
  expect(f.createEncoder).toHaveBeenCalledWith(480, 480, true)
  expect(f.renderFrames).toHaveBeenCalledWith({ mesh, size: [480, 480], background: null, cameras: turntablePoses(mesh.bounds, 72) })
  expect(f.delays).toHaveLength(72)
  expect(new Set(f.delays)).toEqual(new Set([60]))
  expect(progress.at(-1)).toEqual({ done: 72, total: 72, bytes: 72_000 })
  expect(f.encoder.terminate).toHaveBeenCalled()
})

it('uses the viewport token for a solid ground', async () => {
  const f = fakes()
  await exportTurntable(
    { mesh, size: [640, 480], frames: 36, transparent: false, signal: new AbortController().signal, onProgress: () => {} },
    f.deps,
  )
  expect(f.renderFrames.mock.calls[0][0].background).toBe('token:viewport')
  expect(f.createEncoder).toHaveBeenCalledWith(640, 480, false)
})

it('stops on cancel without finishing the GIF', async () => {
  const f = fakes()
  const controller = new AbortController()
  const run = exportTurntable(
    {
      mesh,
      size: [480, 480],
      frames: 36,
      transparent: false,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.done === 3) controller.abort()
      },
    },
    f.deps,
  )
  await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.delays).toHaveLength(3)
  expect(f.encoder.finish).not.toHaveBeenCalled()
  expect(f.encoder.terminate).toHaveBeenCalled()
})
