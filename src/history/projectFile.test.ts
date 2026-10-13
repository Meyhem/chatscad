// @vitest-environment node
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { putMessage } from '../db/messages'
import { putPreset } from '../db/presets'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { exportAllProjects, exportProject, importFromText, importProjectFile, parseImport, projectFileName, type ProjectFile } from './projectFile'
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
    ['a different format', (f: any) => (f.format = 'zip'), 'format must be "chatscad-project" or "chatscad-backup"'],
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
    expect(parseImport({ format: 'chatscad-backup', version: 1, exportedAt: 1, projects: [file, bad] })).toEqual({
      ok: false,
      error: 'projects[1].versions[0].code must be text',
    })
  })

  it('rejects text that is not JSON', async () => {
    expect(await importFromText('{nope')).toEqual({ ok: false, error: 'The file is not valid JSON' })
  })
})

it('names export files after the project', () => {
  expect(projectFileName('Box with lid')).toBe('box-with-lid.chatscad.json')
  expect(projectFileName('  ***  ')).toBe('project.chatscad.json')
})

it('opens a share link saved as .json from the same import', async () => {
  const { useProjectStore } = await import('./projectStore')
  const result = await importFromText(JSON.stringify({ v: 1, name: 'Shared hook', code: 'cube(4);', params: {} }))
  expect(result.ok).toBe(true)
  expect(useProjectStore.getState().project?.name).toBe('Shared hook')
  expect(useProjectStore.getState().head?.code).toBe('cube(4);')
})

it('exports and imports the reasoning, and imports files that predate it', async () => {
  const project = await store().newProject({ name: 'R', code: 'cube(1);', origin: 'blank' })
  await putMessage({
    id: 'r1', projectId: project.id, versionId: null, role: 'assistant', content: 'Done.', imageBlobIds: [], audioTranscript: null,
    model: 'm', usageId: null, createdAt: 1, reasoning: '<b>Wall</b> is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12,
  })
  const file = await exportProject(project.id)
  expect(file.messages[0]).toMatchObject({ reasoning: '<b>Wall</b> is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12 })

  const result = await importFromText(JSON.stringify(file))
  if (!result.ok) throw new Error(result.error)
  const imported = await db.messages.where('projectId').equals(result.projects[0]!.id).toArray()
  expect(imported[0]).toMatchObject({ reasoning: '<b>Wall</b> is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12 })

  const legacy = JSON.parse(JSON.stringify(file)) as ProjectFile
  for (const m of legacy.messages as unknown as Array<Record<string, unknown>>) {
    delete m.reasoning
    delete m.reasoningMs
    delete m.reasoningTokens
  }
  const parsed = parseImport(legacy)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) expect(parsed.files[0]!.messages[0]).toMatchObject({ reasoning: null, reasoningMs: null, reasoningTokens: null })
})

it('rejects a reasoning that is not text', async () => {
  const project = await store().newProject({ name: 'R', code: 'cube(1);', origin: 'blank' })
  await putMessage({
    id: 'r2', projectId: project.id, versionId: null, role: 'assistant', content: 'Done.', imageBlobIds: [], audioTranscript: null,
    model: 'm', usageId: null, createdAt: 1,
  })
  const file = JSON.parse(JSON.stringify(await exportProject(project.id))) as ProjectFile
  ;(file.messages[0] as unknown as Record<string, unknown>).reasoning = 42
  expect(parseImport(file).ok).toBe(false)
})

it('exports and imports the checks, and imports files without them', async () => {
  const project = await store().newProject({ name: 'Holder', code: 'cube(1);', origin: 'blank' })
  await store().setChecks([{ id: 'c1', kind: 'size', text: 'Walls at least 2 mm' }])
  const file = await exportProject(project.id)
  expect(file.project.checks).toEqual([{ id: 'c1', kind: 'size', text: 'Walls at least 2 mm' }])
  const copy = await importProjectFile(file)
  expect(copy.checks).toEqual([{ id: 'c1', kind: 'size', text: 'Walls at least 2 mm' }])

  const { checks: _, ...withoutChecks } = file.project
  const parsed = parseImport({ ...file, project: withoutChecks })
  expect(parsed.ok && parsed.files[0].project.checks).toBeUndefined()

  const bad = parseImport({ ...file, project: { ...file.project, checks: 'all of them' } })
  expect(bad).toEqual({ ok: false, error: 'project.checks must be a list' })
})

it('exports and imports photos, the brief and the scale', async () => {
  await db.blobs.put({ id: 'ph-1', kind: 'image', data: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) })
  const project = await store().newProject({
    code: 'cube(1);', origin: 'photos', brief: 'A bracket', scale: 'description',
    photos: [{ id: 'p1', blobId: 'ph-1', angle: 'front', addedAt: 1 }],
  })
  const file = await exportProject(project.id)
  expect(file.project).toMatchObject({ origin: 'photos', brief: 'A bracket', scale: 'description' })
  expect(file.project.photos).toEqual([{ angle: 'front', mediaType: 'image/png', data: 'iVBORw==' }])

  const parsed = parseImport(JSON.parse(JSON.stringify(file)))
  expect(parsed.ok).toBe(true)
  const imported = await importProjectFile((parsed as { ok: true; files: ProjectFile[] }).files[0]!)
  expect(imported.photos).toHaveLength(1)
  expect(imported.photos![0]!.angle).toBe('front')
  const blob = await db.blobs.get(imported.photos![0]!.blobId)
  expect(blob?.kind).toBe('image')
  expect(new Uint8Array(await blob!.data.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
  expect(imported.brief).toBe('A bracket')
})

it('refuses photo data that is not base64 image data, or too many photos', async () => {
  const base = (await exportProject((await sampleProject()).id)) as ProjectFile
  const bad = { ...base, project: { ...base.project, origin: 'photos', photos: [{ angle: 'front', mediaType: 'image/png', data: 'not base64!!' }] } }
  expect(parseImport(bad)).toEqual({ ok: false, error: 'project.photos[0].data must be base64 image data' })
  const many = { ...base, project: { ...base.project, photos: Array.from({ length: 6 }, () => ({ angle: 'top', mediaType: 'image/jpeg', data: 'AA==' })) } }
  expect(parseImport(many)).toEqual({ ok: false, error: 'project.photos has more than 5 entries' })
  const wrongAngle = { ...base, project: { ...base.project, photos: [{ angle: 'diagonal', mediaType: 'image/jpeg', data: 'AA==' }] } }
  expect(parseImport(wrongAngle)).toEqual({ ok: false, error: 'project.photos[0].angle must be one of photo, front, top, side, back, bottom, other' })
})
