import { db, type Preset, type Project, type StoredMessage, type Version, type VersionSource } from '../db/db'
import { listMessages } from '../db/messages'
import { listPresets } from '../db/presets'
import { getProject, listAllProjects } from '../db/projects'
import { saveFile } from '../export/saveFile'
import { isLibraryName } from '../render/libraries'
import type { ParamValue } from '../render/types'
import { listVersions } from './versions'

export const PROJECT_FORMAT = 'promptcad-project'
export const BACKUP_FORMAT = 'promptcad-backup'
export const MAX_CODE_LENGTH = 1_000_000
export const MAX_FILE_LENGTH = 50_000_000

export type FileVersion = Omit<Version, 'projectId' | 'thumbnailBlobId'>
export type FileMessage = Omit<StoredMessage, 'projectId' | 'imageBlobIds' | 'usageId'>
export type FilePreset = Omit<Preset, 'projectId'>

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: 1
  exportedAt: number
  project: { name: string; origin: Project['origin']; enabledLibraries: string[] }
  headVersionId: string
  versions: FileVersion[]
  messages: FileMessage[]
  presets: FilePreset[]
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: 1
  exportedAt: number
  projects: ProjectFile[]
}

export type ParseResult = { ok: true; files: ProjectFile[] } | { ok: false; error: string }

const SOURCES: readonly VersionSource[] = ['ai', 'manual', 'slider', 'autofix', 'restore', 'gallery', 'import']
const ORIGINS: readonly Project['origin'][] = ['blank', 'gallery', 'shared-link']
const ROLES: readonly StoredMessage['role'][] = ['user', 'assistant', 'note']
const STATUSES: readonly Version['compileStatus'][] = ['ok', 'error', 'pending']
const KINDS: readonly Version['kind'][] = ['main', 'variant']
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
const LABEL = /^v\d+(\.\d+)*$/

class Invalid extends Error {}

function fail(path: string, what: string): never {
  throw new Invalid(`${path} ${what}`)
}

type Obj = Record<string, unknown>

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'must be an object')
  return v as Obj
}

function str(o: Obj, key: string, path: string, max: number): string {
  const v = o[key]
  if (typeof v !== 'string') fail(`${path}${key}`, 'must be text')
  if (v.length > max) fail(`${path}${key}`, `is longer than ${max.toLocaleString('en-US')} characters`)
  return v
}

const strOrNull = (o: Obj, key: string, path: string, max: number): string | null => (o[key] === null ? null : str(o, key, path, max))

function num(o: Obj, key: string, path: string): number {
  const v = o[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}${key}`, 'must be a number')
  return v
}

const numOrNull = (o: Obj, key: string, path: string): number | null => (o[key] === null ? null : num(o, key, path))

function oneOf<T extends string>(o: Obj, key: string, path: string, values: readonly T[]): T {
  const v = o[key]
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) fail(`${path}${key}`, `must be one of ${values.join(', ')}`)
  return v as T
}

function list(o: Obj, key: string, path: string, max: number): unknown[] {
  const v = o[key]
  if (!Array.isArray(v)) fail(`${path}${key}`, 'must be a list')
  if (v.length > max) fail(`${path}${key}`, `has more than ${max.toLocaleString('en-US')} entries`)
  return v
}

function params(v: unknown, path: string): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  for (const [name, value] of Object.entries(obj(v, path))) {
    if (FORBIDDEN.has(name) || !PARAM_NAME.test(name)) fail(path, `has an invalid parameter name "${name}"`)
    if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 10_000)) {
      out[name] = value
    } else if (Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      out[name] = [...(value as number[])]
    } else {
      fail(`${path}.${name}`, 'must be a number, true/false, text or a list of 1 to 4 numbers')
    }
  }
  return out
}

function parseProject(v: unknown, at: string): ProjectFile {
  const p = at ? `${at}.` : ''
  const o = obj(v, at || 'The file')
  if (o.format !== PROJECT_FORMAT) fail(`${p}format`, `must be "${PROJECT_FORMAT}"`)
  if (o.version !== 1) fail(`${p}version`, 'must be 1')

  const project = obj(o.project, `${p}project`)
  const name = str(project, 'name', `${p}project.`, 200).trim()
  if (name === '') fail(`${p}project.name`, 'must not be empty')
  const origin = oneOf(project, 'origin', `${p}project.`, ORIGINS)
  const enabledLibraries = list(project, 'enabledLibraries', `${p}project.`, 10).map((lib, i) =>
    typeof lib === 'string' && isLibraryName(lib) ? lib : fail(`${p}project.enabledLibraries[${i}]`, 'must be BOSL2 or MCAD'),
  )

  const ids = new Set<string>()
  const labels = new Set<string>()
  const versions = list(o, 'versions', p, 5_000).map((raw, i): FileVersion => {
    const path = `${p}versions[${i}].`
    const x = obj(raw, `${p}versions[${i}]`)
    const id = str(x, 'id', path, 100)
    if (ids.has(id)) fail(`${path}id`, 'repeats an earlier id')
    const parentId = strOrNull(x, 'parentId', path, 100)
    if (parentId !== null && !ids.has(parentId)) fail(`${path}parentId`, 'points at a version that is not earlier in the file')
    const label = str(x, 'label', path, 50)
    if (!LABEL.test(label)) fail(`${path}label`, 'must look like v3 or v3.1')
    if (labels.has(label)) fail(`${path}label`, 'repeats an earlier label')
    const version: FileVersion = {
      id,
      parentId,
      code: str(x, 'code', path, MAX_CODE_LENGTH),
      params: params(x.params, `${path}params`),
      source: oneOf(x, 'source', path, SOURCES),
      kind: oneOf(x, 'kind', path, KINDS),
      variantGroupId: strOrNull(x, 'variantGroupId', path, 100),
      label,
      message: str(x, 'message', path, 2_000),
      model: strOrNull(x, 'model', path, 200),
      compileStatus: oneOf(x, 'compileStatus', path, STATUSES),
      renderMs: numOrNull(x, 'renderMs', path),
      createdAt: num(x, 'createdAt', path),
    }
    ids.add(id)
    labels.add(label)
    return version
  })
  if (versions.length === 0) fail(`${p}versions`, 'must contain at least one version')

  const head = o.headVersionId
  if (typeof head !== 'string' || !ids.has(head)) fail(`${p}headVersionId`, 'must name a version in the file')

  const messages = list(o, 'messages', p, 20_000).map((raw, i): FileMessage => {
    const path = `${p}messages[${i}].`
    const x = obj(raw, `${p}messages[${i}]`)
    const versionId = strOrNull(x, 'versionId', path, 100)
    if (versionId !== null && !ids.has(versionId)) fail(`${path}versionId`, 'must name a version in the file')
    return {
      id: str(x, 'id', path, 100),
      versionId,
      role: oneOf(x, 'role', path, ROLES),
      content: str(x, 'content', path, 200_000),
      audioTranscript: strOrNull(x, 'audioTranscript', path, 20_000),
      model: strOrNull(x, 'model', path, 200),
      createdAt: num(x, 'createdAt', path),
    }
  })

  const presets = list(o, 'presets', p, 1_000).map((raw, i): FilePreset => {
    const path = `${p}presets[${i}].`
    const x = obj(raw, `${p}presets[${i}]`)
    return { id: str(x, 'id', path, 100), name: str(x, 'name', path, 100), params: params(x.params, `${path}params`) }
  })

  return {
    format: PROJECT_FORMAT,
    version: 1,
    exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : 0,
    project: { name, origin, enabledLibraries },
    headVersionId: head,
    versions,
    messages,
    presets,
  }
}

export function parseImport(data: unknown): ParseResult {
  try {
    const o = obj(data, 'The file')
    if (o.format === BACKUP_FORMAT) {
      if (o.version !== 1) fail('version', 'must be 1')
      return { ok: true, files: list(o, 'projects', '', 1_000).map((p, i) => parseProject(p, `projects[${i}]`)) }
    }
    if (o.format !== PROJECT_FORMAT) fail('format', `must be "${PROJECT_FORMAT}" or "${BACKUP_FORMAT}"`)
    return { ok: true, files: [parseProject(o, '')] }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }
}

export async function exportProject(projectId: string): Promise<ProjectFile> {
  const project = await getProject(projectId)
  if (!project || !project.headVersionId) throw new Error(`Project ${projectId} not found`)
  const [versions, messages, presets] = await Promise.all([listVersions(projectId), listMessages(projectId), listPresets(projectId)])
  return {
    format: PROJECT_FORMAT,
    version: 1,
    exportedAt: Date.now(),
    project: { name: project.name, origin: project.origin, enabledLibraries: project.enabledLibraries },
    headVersionId: project.headVersionId,
    versions: versions.map((v) => ({
      id: v.id, parentId: v.parentId, code: v.code, params: v.params, source: v.source, kind: v.kind, variantGroupId: v.variantGroupId,
      label: v.label, message: v.message, model: v.model, compileStatus: v.compileStatus, renderMs: v.renderMs, createdAt: v.createdAt,
    })),
    messages: messages.map((m) => ({
      id: m.id, versionId: m.versionId, role: m.role, content: m.content, audioTranscript: m.audioTranscript, model: m.model, createdAt: m.createdAt,
    })),
    presets: presets.map((p) => ({ id: p.id, name: p.name, params: p.params })),
  }
}

export async function exportAllProjects(): Promise<BackupFile> {
  const projects = await listAllProjects()
  return { format: BACKUP_FORMAT, version: 1, exportedAt: Date.now(), projects: await Promise.all(projects.map((p) => exportProject(p.id))) }
}

export async function importProjectFile(file: ProjectFile): Promise<Project> {
  const projectId = crypto.randomUUID()
  const newId = new Map(file.versions.map((v) => [v.id, crypto.randomUUID()]))
  const now = Date.now()
  const project: Project = {
    id: projectId,
    name: file.project.name,
    createdAt: now,
    updatedAt: now,
    headVersionId: newId.get(file.headVersionId)!,
    providerProfileId: null,
    enabledLibraries: file.project.enabledLibraries,
    origin: file.project.origin,
  }
  const versions: Version[] = file.versions.map((v) => ({
    ...v,
    id: newId.get(v.id)!,
    projectId,
    parentId: v.parentId === null ? null : newId.get(v.parentId)!,
    thumbnailBlobId: null,
  }))
  const messages: StoredMessage[] = file.messages.map((m) => ({
    ...m,
    id: crypto.randomUUID(),
    projectId,
    versionId: m.versionId === null ? null : newId.get(m.versionId)!,
    imageBlobIds: [],
    usageId: null,
  }))
  const presets: Preset[] = file.presets.map((p) => ({ ...p, id: crypto.randomUUID(), projectId }))
  await db.transaction('rw', [db.projects, db.versions, db.messages, db.presets], async () => {
    await db.projects.add(project)
    await db.versions.bulkAdd(versions)
    await db.messages.bulkAdd(messages)
    await db.presets.bulkAdd(presets)
  })
  return project
}

export async function importFromText(text: string): Promise<{ ok: true; projects: Project[] } | { ok: false; error: string }> {
  if (text.length > MAX_FILE_LENGTH) return { ok: false, error: 'The file is larger than 50 MB' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The file is not valid JSON' }
  }
  const parsed = parseImport(data)
  if (!parsed.ok) return parsed
  const projects: Project[] = []
  for (const file of parsed.files) projects.push(await importProjectFile(file))
  return { ok: true, projects }
}

export function projectFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug || 'project'}.promptcad.json`
}

const jsonBlob = (data: unknown) => new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })

export async function saveProjectFile(projectId: string): Promise<void> {
  const file = await exportProject(projectId)
  await saveFile(jsonBlob(file), projectFileName(file.project.name))
}

export async function saveBackupFile(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  await saveFile(jsonBlob(await exportAllProjects()), `promptcad-backup-${date}.json`)
}
