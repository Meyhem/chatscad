// @vitest-environment node
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { putMessage } from '../db/messages'
import { putPreset } from '../db/presets'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { exportAllProjects, exportProject, importFromText, parseImport, projectFileName, type ProjectFile } from './projectFile'
import { useProjectStore } from './projectStore'
import { listVersions } from './versions'

const store = () => useProjectStore.getState()
const commit = (code: string, params = {}) =>
  store().commit({ code, params, source: 'manual', message: 'edit', model: null, compileStatus: 'ok', renderMs: 1 })

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

async function sampleProject() {
  const project = await store().newProject({ name: 'Box with lid', code: 'w = 1; // [0:9]\ncube(w);', origin: 'gallery', enabledLibraries: ['BOSL2'] })
  const v2 = await commit('cube(2);', {})
  await commit('cube(3);')
  await store().branchFrom(v2.id)
  await commit('cube(22);', {})
  await putMessage({
    id: 'm1', projectId: project.id, versionId: v2.id, role: 'assistant', content: '<img src=x onerror=alert(1)>',
    imageBlobIds: ['img-1'], audioTranscript: null, model: 'gpt-x', usageId: 'u1', createdAt: 5,
  })
  await putPreset({ id: 's1', projectId: project.id, name: 'big', params: { w: 9 } })
  await db.providerProfiles.put({
    id: 'p', name: 'OpenAI', adapter: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret-key',
    defaultModel: 'gpt-x', cachedModels: [], capabilities: { streaming: true, vision: false, audio: false }, priceTable: {}, createdAt: 1, updatedAt: 1,
  })
  return store().project!
}

it('exports a project without keys, usage ids, thumbnails or images, and imports it as a new project', async () => {
  const original = await sampleProject()
  const file = await exportProject(original.id)
  const text = JSON.stringify(file)
  expect(text).not.toContain('sk-secret-key')
  expect(text).not.toContain('thumbnailBlobId')
  expect(text).not.toContain('img-1')
  expect(text).not.toContain('u1')
  expect(file.versions.map((v) => v.label)).toEqual(['v1', 'v2', 'v3', 'v2.1'])

  const result = await importFromText(text)
  if (!result.ok) throw new Error(result.error)
  const copy = result.projects[0]!
  expect(copy).toMatchObject({ name: 'Box with lid', origin: 'gallery', enabledLibraries: ['BOSL2'] })
  expect(copy.id).not.toBe(original.id)
  const versions = await listVersions(copy.id)
  const byId = new Map(versions.map((v) => [v.id, v]))
  expect(versions.map((v) => `${v.label}<${v.parentId ? byId.get(v.parentId)!.label : '-'}`)).toEqual(['v1<-', 'v2<v1', 'v3<v2', 'v2.1<v2'])
  expect(byId.get(copy.headVersionId!)?.label).toBe('v2.1')
  expect(versions.every((v) => !v.id.startsWith('v') && v.thumbnailBlobId === null)).toBe(true)
  const messages = await db.messages.where('projectId').equals(copy.id).toArray()
  expect(messages).toEqual([expect.objectContaining({ content: '<img src=x onerror=alert(1)>', imageBlobIds: [], usageId: null, versionId: versions[1]!.id })])
  expect(await db.presets.where('projectId').equals(copy.id).toArray()).toEqual([expect.objectContaining({ name: 'big', params: { w: 9 } })])
})

it('exports and imports a backup of every project', async () => {
  await sampleProject()
  await store().newProject({ name: 'Clip', code: 'cube(1);', origin: 'blank' })
  const backup = await exportAllProjects()
  expect(backup.projects.map((p) => p.project.name).sort()).toEqual(['Box with lid', 'Clip'])
  const result = await importFromText(JSON.stringify(backup))
  expect(result.ok && result.projects.map((p) => p.name).sort()).toEqual(['Box with lid', 'Clip'])
  expect(await db.projects.count()).toBe(4)
})

describe('validation', () => {
  let file: ProjectFile
  beforeEach(async () => {
    file = await exportProject((await sampleProject()).id)
  })

  const mutate = (fn: (f: Record<string, any>) => void) => {
    const copy = JSON.parse(JSON.stringify(file))
    fn(copy)
    return copy
  }

  it.each([
    ['a different format', (f: any) => (f.format = 'zip'), 'format must be "promptcad-project" or "promptcad-backup"'],
    ['code that is not text', (f: any) => (f.versions[0].code = 5), 'versions[0].code must be text'],
    ['code that is too long', (f: any) => (f.versions[0].code = 'x'.repeat(1_000_001)), 'versions[0].code is longer than 1,000,000 characters'],
    ['a parent later in the file', (f: any) => (f.versions[1].parentId = f.versions[2].id), 'versions[1].parentId points at a version that is not earlier in the file'],
    ['a __proto__ parameter', (f: any) => (f.versions[0].params = JSON.parse('{"__proto__": 1}')), 'versions[0].params has an invalid parameter name "__proto__"'],
    ['an object parameter value', (f: any) => (f.versions[0].params = { w: { x: 1 } }), 'versions[0].params.w must be a number, true/false, text or a list of 1 to 4 numbers'],
    ['a missing head', (f: any) => (f.headVersionId = 'nope'), 'headVersionId must name a version in the file'],
    ['an unknown library', (f: any) => (f.project.enabledLibraries = ['../evil']), 'project.enabledLibraries[0] must be BOSL2 or MCAD'],
    ['a message on an unknown version', (f: any) => (f.messages[0].versionId = 'nope'), 'messages[0].versionId must name a version in the file'],
    ['an unknown source', (f: any) => (f.versions[0].source = 'magic'), 'versions[0].source must be one of ai, manual, slider, autofix, restore, gallery, import'],
    ['a repeated label', (f: any) => (f.versions[1].label = 'v1'), 'versions[1].label repeats an earlier label'],
  ])('rejects %s and names the field', async (_name, fn, error) => {
    const before = await db.projects.count()
    expect(parseImport(mutate(fn))).toEqual({ ok: false, error })
    expect(await importFromText(JSON.stringify(mutate(fn)))).toEqual({ ok: false, error })
    expect(await db.projects.count()).toBe(before)
  })

  it('names the project inside a backup', () => {
    const bad = mutate((f) => (f.versions[0].code = null))
    expect(parseImport({ format: 'promptcad-backup', version: 1, exportedAt: 1, projects: [file, bad] })).toEqual({
      ok: false,
      error: 'projects[1].versions[0].code must be text',
    })
  })

  it('rejects text that is not JSON', async () => {
    expect(await importFromText('{nope')).toEqual({ ok: false, error: 'The file is not valid JSON' })
  })
})

it('names export files after the project', () => {
  expect(projectFileName('Box with lid')).toBe('box-with-lid.promptcad.json')
  expect(projectFileName('  ***  ')).toBe('project.promptcad.json')
})

it('opens a share link saved as .json from the same import', async () => {
  const { useProjectStore } = await import('./projectStore')
  const result = await importFromText(JSON.stringify({ v: 1, name: 'Shared hook', code: 'cube(4);', params: {} }))
  expect(result.ok).toBe(true)
  expect(useProjectStore.getState().project?.name).toBe('Shared hook')
  expect(useProjectStore.getState().head?.code).toBe('cube(4);')
})
