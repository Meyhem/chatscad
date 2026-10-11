import { useAttachments } from '../images/attachments'
import { attachSketch } from './exportSketch'

beforeEach(() => {
  useAttachments.setState(useAttachments.getInitialState(), true)
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:sketch'), revokeObjectURL: vi.fn() })
})
afterEach(() => vi.restoreAllMocks())

it('draws the sketch into a PNG and attaches it with its note', async () => {
  const fillRect = vi.fn()
  const noop = () => {}
  const ctx = { fillRect, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop, fillText: noop }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })))

  await attachSketch({ items: [{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }], note: 'Two M4 holes' })

  expect(fillRect).toHaveBeenCalledWith(0, 0, 600, 800)
  expect(useAttachments.getState().items).toMatchObject([{ name: 'Sketch', mediaType: 'image/png', note: 'Two M4 holes' }])
})

it('says so when the sketch cannot be saved', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  await attachSketch({ items: [], note: '' })
  expect(useAttachments.getState().error).toBe('Could not save the sketch. Try again, or attach a photo of a drawing instead.')
})
