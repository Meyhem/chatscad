import type { PreparedImage } from './prepareImage'
import { MAX_ATTACHMENTS, useAttachments } from './attachments'

const prepared = (type: PreparedImage['mediaType'] = 'image/jpeg'): PreparedImage => ({
  blob: new Blob(['x'], { type }),
  mediaType: type,
  width: 10,
  height: 10,
})
const okPrepare = vi.fn(async (_blob: Blob, type: PreparedImage['mediaType']) => prepared(type))
const file = (name: string, type: string) => new File(['x'], name, { type })

beforeEach(() => {
  useAttachments.setState(useAttachments.getInitialState(), true)
  okPrepare.mockClear()
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thumb'), revokeObjectURL: vi.fn() })
})

it('adds images with a thumbnail URL, as JPEG for photos and PNG for PNGs', async () => {
  await useAttachments.getState().addFiles([file('photo.jpg', 'image/jpeg'), file('plan.png', 'image/png')], okPrepare)
  const items = useAttachments.getState().items
  expect(items.map((i) => [i.name, i.mediaType, i.url])).toEqual([
    ['photo.jpg', 'image/jpeg', 'blob:thumb'],
    ['plan.png', 'image/png', 'blob:thumb'],
  ])
  expect(useAttachments.getState().error).toBeNull()
})

it('names a file that is not an image', async () => {
  await useAttachments.getState().addFiles([file('notes.txt', 'text/plain')], okPrepare)
  expect(useAttachments.getState().items).toHaveLength(0)
  expect(useAttachments.getState().error).toBe('notes.txt is not an image. Attach a PNG, JPEG or WebP image.')
})

it('names a file the browser cannot read', async () => {
  const failing = vi.fn(() => Promise.reject(new Error('decode')))
  await useAttachments.getState().addFiles([file('photo.heic', 'image/heic')], failing)
  expect(useAttachments.getState().error).toBe('Could not read photo.heic. Attach a PNG, JPEG or WebP image.')
})

it('stops at four images per message', async () => {
  const files = ['1', '2', '3', '4', '5'].map((n) => file(`${n}.jpg`, 'image/jpeg'))
  await useAttachments.getState().addFiles(files, okPrepare)
  expect(useAttachments.getState().items).toHaveLength(MAX_ATTACHMENTS)
  expect(useAttachments.getState().error).toBe('Up to 4 images per message. 5.jpg was not added.')
})

it('revokes thumbnail URLs on remove and clear', async () => {
  await useAttachments.getState().addFiles([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')], okPrepare)
  const [a] = useAttachments.getState().items
  useAttachments.getState().remove(a.id)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  useAttachments.getState().clear()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  expect(useAttachments.getState().items).toHaveLength(0)
})

it('keeps a note with prepared images such as sketches', () => {
  useAttachments.getState().addPrepared(prepared('image/png'), 'Sketch', 'two M4 holes')
  expect(useAttachments.getState().items[0]).toMatchObject({ name: 'Sketch', note: 'two M4 holes', mediaType: 'image/png' })
})
