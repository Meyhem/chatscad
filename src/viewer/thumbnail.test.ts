import { staleText } from './staleText'
import { captureThumbnail, setThumbnailSource, squareCrop, THUMBNAIL_SIZE } from './thumbnail'

afterEach(() => setThumbnailSource(null))

const noFrame = async () => {}

function fakeCanvas(events: string[], context: object | null = { drawImage: vi.fn(() => events.push('draw')) }) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (cb: BlobCallback, type?: string) => {
      events.push(`encode ${type}`)
      cb(new Blob(['png'], { type }))
    },
  }
  return { canvas, context, create: (size: number) => Object.assign(canvas, { width: size, height: size }) as unknown as HTMLCanvasElement }
}

it('crops the centre square of a wide or tall canvas', () => {
  expect(squareCrop(800, 600)).toEqual({ sx: 100, sy: 0, size: 600 })
  expect(squareCrop(300, 500)).toEqual({ sx: 0, sy: 100, size: 300 })
})

it('returns null when no viewer is registered', async () => {
  expect(await captureThumbnail({ nextFrame: noFrame })).toBeNull()
})

it('waits a frame, renders, copies the centre square into a 96 px canvas in the same task, then encodes a PNG', async () => {
  const events: string[] = []
  const src = { width: 800, height: 600 } as HTMLCanvasElement
  setThumbnailSource(() => {
    events.push('render')
    return src
  })
  const { canvas, context, create } = fakeCanvas(events)
  const blob = await captureThumbnail({ nextFrame: async () => void events.push('frame'), createCanvas: create })
  expect(events).toEqual(['frame', 'render', 'draw', 'encode image/png'])
  expect((context as { drawImage: ReturnType<typeof vi.fn> }).drawImage).toHaveBeenCalledWith(src, 100, 0, 600, 600, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  expect(canvas.width).toBe(96)
  expect(blob?.type).toBe('image/png')
})

it('returns null for an empty canvas or a missing 2D context', async () => {
  setThumbnailSource(() => ({ width: 0, height: 0 }) as HTMLCanvasElement)
  expect(await captureThumbnail({ nextFrame: noFrame, createCanvas: fakeCanvas([]).create })).toBeNull()
  setThumbnailSource(() => ({ width: 10, height: 10 }) as HTMLCanvasElement)
  expect(await captureThumbnail({ nextFrame: noFrame, createCanvas: fakeCanvas([], null).create })).toBeNull()
})

it('names the version the stale model came from when it is known', () => {
  expect(staleText('v3')).toBe('Showing v3, the last version that compiled')
  expect(staleText(null)).toBe('Showing the last model that compiled')
})
