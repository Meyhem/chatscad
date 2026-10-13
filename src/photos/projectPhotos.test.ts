import type { ImageCodec } from '../images/prepareImage'
import { loadPhotos, MAX_PROJECT_PHOTOS, PHOTO_LABEL, photoParts, preparePhoto, tooManyPhotos, type ProjectPhoto } from './projectPhotos'

const codec: ImageCodec = {
  decode: async () => ({ width: 4000, height: 3000 }),
  encode: async (_i, width, height, type) => new Blob([`${width}x${height}`], { type }),
}

const photo = (angle: ProjectPhoto['angle'], blobId = `b-${angle}`): ProjectPhoto => ({ id: `p-${angle}`, blobId, angle, addedAt: 1 })

it('downscales a photo to 1024 px on the long edge', async () => {
  const out = await preparePhoto(new Blob(['x'], { type: 'image/jpeg' }), 'image/jpeg', codec)
  expect([out.width, out.height]).toEqual([1024, 768])
  expect(await out.blob.text()).toBe('1024x768')
})

it('loads the photos that exist and counts the missing ones', async () => {
  const blobs: Record<string, Blob> = { 'b-front': new Blob(['f'], { type: 'image/jpeg' }) }
  const { loaded, missing } = await loadPhotos([photo('front'), photo('top')], async (id) => blobs[id] ?? null)
  expect(loaded.map((l) => l.photo.angle)).toEqual(['front'])
  expect(loaded[0]!.mediaType).toBe('image/jpeg')
  expect(missing).toBe(1)
})

it('turns loaded photos into labelled image parts, in order', async () => {
  const loaded = [
    { photo: photo('top'), blob: new Blob(['t'], { type: 'image/png' }), mediaType: 'image/png' as const },
    { photo: photo('other'), blob: new Blob(['o'], { type: 'image/jpeg' }), mediaType: 'image/jpeg' as const },
  ]
  const parts = await photoParts(loaded, async (b) => `base64:${await b.text()}`)
  expect(parts).toEqual([
    { type: 'text', text: 'Reference photo (top)' },
    { type: 'image', mediaType: 'image/png', data: 'base64:t' },
    { type: 'text', text: 'Reference photo (other angle)' },
    { type: 'image', mediaType: 'image/jpeg', data: 'base64:o' },
  ])
})

it('names the limit and the file that was not added', () => {
  expect(MAX_PROJECT_PHOTOS).toBe(5)
  expect(tooManyPhotos('IMG_0412.jpg')).toBe('Up to 5 photos per project. IMG_0412.jpg was not added.')
  expect(PHOTO_LABEL.other).toBe('Other angle')
})
