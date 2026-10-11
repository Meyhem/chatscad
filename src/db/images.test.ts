// @vitest-environment node
import 'fake-indexeddb/auto'
import { PromptCadDb } from './db'
import { loadImage, saveImage } from './images'

let database: PromptCadDb
beforeEach(() => {
  database = new PromptCadDb(`images-${crypto.randomUUID()}`)
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
