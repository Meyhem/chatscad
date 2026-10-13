import { addDraftPhotos, layoutFor, removeDraftPhoto, type DraftState } from './photoDraft'

const file = (name: string, type = 'image/jpeg') => new File(['x'], name, { type })
const prepare = async (b: Blob) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 10, height: 10 })
const url = () => 'blob:1'
const empty: DraftState = { photos: [], error: null }

it('adds photos with their angle and stops at five', async () => {
  let state = await addDraftPhotos(empty, [file('a.jpg'), file('b.jpg')], 'front', prepare, url)
  expect(state.photos.map((p) => p.angle)).toEqual(['front', 'front'])
  for (const n of ['c', 'd', 'e']) state = await addDraftPhotos(state, [file(`${n}.jpg`)], 'top', prepare, url)
  state = await addDraftPhotos(state, [file('f.jpg')], 'side', prepare, url)
  expect(state.photos).toHaveLength(5)
  expect(state.error).toBe('Up to 5 photos per project. f.jpg was not added.')
})

it('skips a file that is not an image or cannot be read, and keeps the rest', async () => {
  const failing = async (b: Blob) => (b.size === 0 ? Promise.reject(new Error('no')) : prepare(b))
  const state = await addDraftPhotos(empty, [file('notes.txt', 'text/plain'), new File([], 'bad.jpg', { type: 'image/jpeg' }), file('ok.jpg')], 'other', failing, url)
  expect(state.photos.map((p) => p.name)).toEqual(['ok.jpg'])
  expect(state.error).toBe('Could not read bad.jpg. Add a PNG, JPEG or WebP image.')
})

it('removes a photo and revokes its url', async () => {
  const state = await addDraftPhotos(empty, [file('a.jpg')], 'front', prepare, url)
  const revoke = vi.fn()
  expect(removeDraftPhoto(state, state.photos[0]!.id, revoke).photos).toEqual([])
  expect(revoke).toHaveBeenCalledWith('blob:1')
})

it('retags photos when the layout changes', async () => {
  const state = await addDraftPhotos(empty, [file('a.jpg'), file('b.jpg')], 'front', prepare, url)
  expect(layoutFor('one', state.photos).map((p) => p.angle)).toEqual(['photo'])
  const one = layoutFor('one', state.photos)
  expect(layoutFor('angles', one).map((p) => p.angle)).toEqual(['other'])
})
