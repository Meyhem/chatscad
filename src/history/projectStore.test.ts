// @vitest-environment node
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { getProject } from '../db/projects'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { matchesHead } from './matchesHead'
import { currentLibraries, onBeforeLeaveHead, useProjectStore } from './projectStore'

const CODE = 'w = 10; // [1:1:50]\ncube(w);'

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  onBeforeLeaveHead(null)
})
afterEach(() => vi.unstubAllGlobals())

const store = () => useProjectStore.getState()
const commit = (code: string, params = {}) =>
  store().commit({ code, params, source: 'manual', message: 'edit', model: null, compileStatus: 'ok', renderMs: 1 })

it('creates a project with version 1 and loads it into the editor', async () => {
  const persist = vi.fn(async () => true)
  vi.stubGlobal('navigator', { storage: { persist } })
  const project = await store().newProject({ name: 'Holder', code: CODE, params: { w: 20 }, origin: 'gallery', source: 'gallery', message: 'Started from Holder', enabledLibraries: ['MCAD'] })

  expect(store().head).toMatchObject({ label: 'v1', source: 'gallery', message: 'Started from Holder', compileStatus: 'pending', parentId: null })
  expect(project).toMatchObject({ name: 'Holder', origin: 'gallery', headVersionId: store().head!.id })
  expect(useAppStore.getState()).toMatchObject({ code: CODE, params: { w: 20 }, libraries: ['MCAD'], codeSource: 'restore' })
  expect(useSettingsStore.getState().settings.lastProjectId).toBe(project.id)
  expect(store().recent.map((p) => p.id)).toEqual([project.id])
  expect(currentLibraries()).toEqual(['MCAD'])
  expect(persist).toHaveBeenCalledTimes(1)

  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  expect(store().project?.name).toBe('Untitled project')
  expect(store().head).toMatchObject({ source: 'manual', message: 'New project' })
  expect(persist).toHaveBeenCalledTimes(1)
})

it('commits children of the head, persists the head and clears redo', async () => {
  await store().newProject({ code: CODE, origin: 'blank' })
  const v2 = await commit('cube(2);')
  const v3 = await commit('cube(3);')
  expect(store().versions.map((v) => v.label)).toEqual(['v1', 'v2', 'v3'])
  expect(v3.parentId).toBe(v2.id)
  expect((await getProject(store().project!.id))?.headVersionId).toBe(v3.id)
})

it('moves along the ancestry with undo and redo', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  await commit('cube(2);')
  await commit('cube(3);')

  await store().undo()
  expect(store().head?.label).toBe('v2')
  expect(useAppStore.getState().code).toBe('cube(2);')
  await store().undo()
  await store().undo()
  expect(store().head?.label).toBe('v1')

  await store().redo()
  await store().redo()
  expect(store().head?.label).toBe('v3')
  expect(useAppStore.getState().code).toBe('cube(3);')
  await store().redo()
  expect(store().head?.label).toBe('v3')

  await store().undo()
  await commit('cube(4);')
  expect(store().redoStack).toEqual([])
})

it('restores an older version as a new version with its code and parameters', async () => {
  await store().newProject({ code: CODE, params: { w: 30 }, origin: 'blank' })
  const v1 = store().head!
  await commit('cube(2);')
  const restored = await store().restore(v1.id)
  expect(restored).toMatchObject({ label: 'v3', source: 'restore', message: 'Restored v1', code: CODE, params: { w: 30 }, compileStatus: 'pending' })
  expect(store().head?.id).toBe(restored.id)
  expect(useAppStore.getState()).toMatchObject({ code: CODE, params: { w: 30 } })
  expect(await store().restore(restored.id)).toBe(store().head)
  expect(store().versions).toHaveLength(3)
})

it('branches from an older version without creating one; the next commit becomes a branch', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  const v2 = await commit('cube(2);')
  await commit('cube(3);')
  await store().branchFrom(v2.id)
  expect(store().versions).toHaveLength(3)
  expect(store().head?.id).toBe(v2.id)
  expect(useAppStore.getState().code).toBe('cube(2);')
  expect((await commit('cube(22);')).label).toBe('v2.1')
})

it('opens a project at its head with its libraries, falling back to the newest version', async () => {
  const first = await store().newProject({ code: 'cube(1);', origin: 'blank', enabledLibraries: ['BOSL2'] })
  await commit('cube(2);')
  await store().newProject({ code: 'sphere(1);', origin: 'blank' })

  await store().openProject(first.id)
  expect(store().head?.label).toBe('v2')
  expect(useAppStore.getState()).toMatchObject({ code: 'cube(2);', libraries: ['BOSL2'] })
  expect(useSettingsStore.getState().settings.lastProjectId).toBe(first.id)

  await db.projects.update(first.id, { headVersionId: 'gone' })
  await store().openProject(first.id)
  expect(store().head?.label).toBe('v2')
  await expect(store().openProject('missing')).rejects.toThrow('Project missing not found')
})

it('awaits the before-leave hook before moving the head', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  const v2 = await commit('cube(2);')
  const calls: string[] = []
  onBeforeLeaveHead(async () => {
    calls.push(`flush at ${store().head?.label}`)
  })
  await store().undo()
  await store().redo()
  await store().restore(store().versions[0]!.id)
  await store().branchFrom(v2.id)
  await store().openProject(store().project!.id)
  await store().newProject({ code: 'x', origin: 'blank' })
  expect(calls).toEqual(['flush at v2', 'flush at v1', 'flush at v2', 'flush at v3', 'flush at v2', 'flush at v2'])
})

it('deletes the open project and opens the most recent other one, or starts a blank one', async () => {
  const a = await store().newProject({ name: 'A', code: 'cube(1);', origin: 'blank' })
  const b = await store().newProject({ name: 'B', code: 'cube(2);', origin: 'blank' })
  await store().deleteProject(b.id)
  expect(store().project?.id).toBe(a.id)
  expect(await db.versions.where('projectId').equals(b.id).count()).toBe(0)

  useAppStore.getState().setCode('sphere(9);')
  await store().deleteProject(a.id)
  expect(store().project).toMatchObject({ name: 'Untitled project', origin: 'blank' })
  expect(store().head?.code).toBe('sphere(9);')
})

it('renames, sets libraries and patches versions', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  await store().renameProject('  Clip  ')
  expect(store().project?.name).toBe('Clip')
  await store().renameProject('   ')
  expect(store().project?.name).toBe('Clip')

  await store().setEnabledLibraries(['BOSL2'])
  expect(useAppStore.getState().libraries).toEqual(['BOSL2'])
  expect((await getProject(store().project!.id))?.enabledLibraries).toEqual(['BOSL2'])

  await store().patchVersion(store().head!.id, { compileStatus: 'ok', renderMs: 9 })
  expect(store().head).toMatchObject({ compileStatus: 'ok', renderMs: 9 })
  expect(store().versions[0]).toMatchObject({ compileStatus: 'ok' })
})

it('matches the head on code plus effective overrides', async () => {
  await store().newProject({ code: CODE, params: { w: 20 }, origin: 'blank' })
  const head = store().head
  expect(matchesHead(CODE, { w: 20 }, head)).toBe(true)
  expect(matchesHead(CODE, { w: 20, nope: 1 }, head)).toBe(true)
  expect(matchesHead(CODE, { w: 10 }, head)).toBe(false)
  expect(matchesHead(`${CODE}\n`, { w: 20 }, head)).toBe(false)
  expect(matchesHead(CODE, {}, null)).toBe(false)
})

it('shows new libraries at once, before the database write finishes, so a controlled switch does not flip back', async () => {
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  const pending = store().setEnabledLibraries(['MCAD'])
  expect(store().project?.enabledLibraries).toEqual(['MCAD'])
  expect(useAppStore.getState().libraries).toEqual(['MCAD'])
  await pending
  expect((await getProject(store().project!.id))?.enabledLibraries).toEqual(['MCAD'])
})
