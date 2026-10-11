import 'fake-indexeddb/auto'
import { PromptCadDb, type Project } from '../db/db'
import { setHead } from './setHead'

const project: Project = {
  id: 'project-1',
  name: 'Hook',
  createdAt: 1,
  updatedAt: 1,
  headVersionId: 'v1',
  providerProfileId: null,
  enabledLibraries: [],
  origin: 'blank',
}

it('moves the project head without creating a version', async () => {
  const database = new PromptCadDb(`head-${crypto.randomUUID()}`)
  await database.projects.put(project)
  await setHead('project-1', 'v4', database)
  const stored = await database.projects.get('project-1')
  expect(stored?.headVersionId).toBe('v4')
  expect(stored?.updatedAt).toBeGreaterThan(1)
  expect(await database.versions.count()).toBe(0)
  await expect(setHead('missing', 'v4', database)).rejects.toThrow('Project missing was not found')
  await database.delete()
})
