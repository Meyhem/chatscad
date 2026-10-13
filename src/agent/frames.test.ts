import { okResult } from '../test/results'
import { renderReviewFrames, REVIEW_FRAME_SIZE, REVIEW_VIEWS } from './frames'

const result = okResult()
if (!result.ok) throw new Error('fixture must succeed')
const mesh = result.mesh

const PALETTE = { colours: ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7'], none: '#a3a9b1' }

function fakeDeps() {
  const calls: Array<{ background: string | null; size: [number, number]; cameras: unknown[]; colours?: Float32Array }> = []
  return {
    calls,
    deps: {
      renderFrames: async function* (opts: { background: string | null; size: [number, number]; cameras: unknown[]; colours?: Float32Array }) {
        calls.push(opts)
        for (const _ of opts.cameras) yield { width: 1, height: 1, data: new Uint8ClampedArray(4) } as unknown as ImageData
      },
      toPng: async () => new Blob(['png'], { type: 'image/png' }),
      palette: () => PALETTE,
      ground: () => '#eceef1',
    },
  }
}

it('renders iso, front, top and right at 768 × 768 px on the frame ground', async () => {
  const { calls, deps } = fakeDeps()
  const frames = await renderReviewFrames(mesh, null, deps)
  expect(REVIEW_VIEWS).toEqual(['iso', 'front', 'top', 'right'])
  expect(REVIEW_FRAME_SIZE).toBe(768)
  expect(frames.map((f) => f.view)).toEqual(REVIEW_VIEWS)
  expect(frames.every((f) => f.png.type === 'image/png')).toBe(true)
  expect(calls).toHaveLength(1)
  expect(calls[0].size).toEqual([768, 768])
  expect(calls[0].background).toBe('#eceef1')
  expect(calls[0].cameras).toHaveLength(4)
  expect(calls[0].colours).toBeUndefined()
})

it('colours each face by its part tag when tags are given', async () => {
  const { calls, deps } = fakeDeps()
  const tags = new Uint32Array(mesh.triangleCount).fill(2)
  await renderReviewFrames({ ...mesh, faceTags: tags }, tags, deps)
  expect(calls[0].colours).toBeInstanceOf(Float32Array)
  expect(calls[0].colours).toHaveLength(mesh.triangleCount * 9)
})
