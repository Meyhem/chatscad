// @vitest-environment node
import 'fake-indexeddb/auto'
import { makeProject, makeVersion } from '../test/fixtures'
import { resetDb } from '../test/resetDb'
import { getBlob, putBlob } from './blobs'
import { db, type StoredMessage } from './db'
import { listMessages, messagesForVersion, putMessage } from './messages'
import { deletePreset, listPresets, putPreset } from './presets'
import { deleteProjectCascade, getProject, listAllProjects, listRecentProjects, putProject } from './projects'

beforeEach(resetDb)

const message = (over: Partial<StoredMessage>): StoredMessage => ({
  id: crypto.randomUUID(),
  projectId: 'p1',
  versionId: null,
  role: 'user',
  content: 'hi',
  imageBlobIds: [],
  audioTranscript: null,
  model: null,
  usageId: null,
  createdAt: 1,
  ...over,
})

it('lists projects newest first and limits the recent list', async () => {
  for (let i = 1; i <= 10; i++) await putProject(makeProject({ id: `p${i}`, name: `P${i}`, updatedAt: i }))
  expect((await listRecentProjects()).map((p) => p.id)).toEqual(['p10', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3'])
  expect(await listRecentProjects(2)).toHaveLength(2)
  expect(await listAllProjects()).toHaveLength(10)
  expect((await getProject('p4'))?.name).toBe('P4')
})

it('deletes a project with its versions, messages, presets and blobs, and nothing else', async () => {
  const thumb = await putBlob('thumbnail', new Blob(['png'], { type: 'image/png' }))
  const image = await putBlob('image', new Blob(['jpg'], { type: 'image/jpeg' }))
  const other = await putBlob('thumbnail', new Blob(['keep']))
  await putProject(makeProject({ id: 'p1' }))
  await putProject(makeProject({ id: 'p2' }))
  await db.versions.bulkAdd([
    makeVersion({ id: 'v1', projectId: 'p1', thumbnailBlobId: thumb }),
    makeVersion({ id: 'w1', projectId: 'p2', thumbnailBlobId: other }),
  ])
  await putMessage(message({ projectId: 'p1', imageBlobIds: [image] }))
  await putMessage(message({ projectId: 'p2' }))
  await putPreset({ id: 's1', projectId: 'p1', name: 'big', params: { w: 1 } })

  await deleteProjectCascade('p1')

  expect(await getProject('p1')).toBeUndefined()
  expect(await db.versions.toArray()).toEqual([expect.objectContaining({ id: 'w1' })])
  expect(await db.messages.count()).toBe(1)
  expect(await listPresets('p1')).toEqual([])
  expect(await getBlob(thumb)).toBeUndefined()
  expect(await getBlob(image)).toBeUndefined()
  expect(await getBlob(other)).toBeDefined()
})

it('lists messages by time, per project and per version', async () => {
  await putMessage(message({ id: 'b', createdAt: 2, versionId: 'v1' }))
  await putMessage(message({ id: 'a', createdAt: 1, versionId: 'v1' }))
  await putMessage(message({ id: 'c', createdAt: 3, projectId: 'p2' }))
  expect((await listMessages('p1')).map((m) => m.id)).toEqual(['a', 'b'])
  expect((await messagesForVersion('v1')).map((m) => m.id)).toEqual(['a', 'b'])
})

it('stores presets by name and deletes them', async () => {
  await putPreset({ id: 's2', projectId: 'p1', name: 'tall', params: { h: 40 } })
  await putPreset({ id: 's1', projectId: 'p1', name: 'big', params: { w: 1 } })
  expect((await listPresets('p1')).map((p) => p.name)).toEqual(['big', 'tall'])
  await deletePreset('s1')
  expect((await listPresets('p1')).map((p) => p.id)).toEqual(['s2'])
})

it('stores blobs and reads them back', async () => {
  const id = await putBlob('thumbnail', new Blob(['abc'], { type: 'image/png' }))
  const stored = await getBlob(id)
  expect(stored?.kind).toBe('thumbnail')
  expect(await stored?.data.text()).toBe('abc')
})

it('deletes a project’s photo blobs with the project', async () => {
  await db.blobs.put({ id: 'photo-1', kind: 'image', data: new Blob(['x']) })
  await db.projects.put({
    id: 'pp', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'photos',
    photos: [{ id: 'p1', blobId: 'photo-1', angle: 'front', addedAt: 1 }],
  })
  await deleteProjectCascade('pp')
  expect(await db.blobs.get('photo-1')).toBeUndefined()
})
