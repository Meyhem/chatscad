// @vitest-environment node
import 'fake-indexeddb/auto'
import { ChatScadDb } from './db'
import { deleteUnreferencedImages, loadImage, saveImage } from './images'

let database: ChatScadDb
beforeEach(() => {
  database = new ChatScadDb(`images-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await database.delete()
})

it('stores images as blobs of kind image and reads them back', async () => {
  const id = await saveImage(new Blob(['png bytes'], { type: 'image/png' }), database)
  expect((await database.blobs.get(id))?.kind).toBe('image')
  const blob = await loadImage(id, database)
  expect(blob?.type).toBe('image/png')
  expect(await blob?.text()).toBe('png bytes')
})

it('returns null for unknown ids and for blobs that are not images', async () => {
  await database.blobs.put({ id: 'thumb', kind: 'thumbnail', data: new Blob(['t']) })
  expect(await loadImage('missing', database)).toBeNull()
  expect(await loadImage('thumb', database)).toBeNull()
})

it('deletes images no message of the project references, and keeps the ones a message does', async () => {
  const kept = await saveImage(new Blob(['k'], { type: 'image/jpeg' }), database)
  const gone = await saveImage(new Blob(['g'], { type: 'image/jpeg' }), database)
  await database.messages.put({ id: 'm', projectId: 'p', versionId: null, role: 'user', content: 'A box', imageBlobIds: [kept], audioTranscript: null, model: null, usageId: null, createdAt: 1 })
  await deleteUnreferencedImages('p', [kept, gone], database)
  expect(await loadImage(kept, database)).not.toBeNull()
  expect(await loadImage(gone, database)).toBeNull()
})

it('deletes only images, never other blobs', async () => {
  await database.blobs.put({ id: 'thumb', kind: 'thumbnail', data: new Blob(['t']) })
  await deleteUnreferencedImages('p', ['thumb'], database)
  expect(await database.blobs.get('thumb')).toBeDefined()
})
