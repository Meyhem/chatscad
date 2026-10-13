import { create } from 'zustand'
import type { Check } from '../agent/checks'
import type { AgentMode, Project, Version, VersionSource } from '../db/db'
import { deleteProjectCascade, getProject, listRecentProjects, putProject } from '../db/projects'
import { MAX_BRIEF_CHARS, type PhotoScale, type ProjectPhoto } from '../photos/projectPhotos'
import type { Params } from '../render/params'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { createVersion, listVersions, updateVersion, type VersionPatch } from './versions'

export const UNTITLED = 'Untitled project'

export interface NewProjectOptions {
  name?: string
  code: string
  params?: Params
  origin: Project['origin']
  source?: VersionSource
  message?: string
  enabledLibraries?: string[]
  photos?: ProjectPhoto[]
  brief?: string
  scale?: PhotoScale
}

export type CommitInput = Pick<Version, 'code' | 'params' | 'source' | 'message' | 'model' | 'compileStatus' | 'renderMs'>

export interface ProjectState {
  project: Project | null
  versions: Version[]
  head: Version | null
  /** Version ids undone from, most recent last; redo pops. */
  redoStack: string[]
  recent: Project[]
  openProject(id: string): Promise<void>
  newProject(opts: NewProjectOptions): Promise<Project>
  restore(versionId: string): Promise<Version>
  branchFrom(versionId: string): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  commit(input: CommitInput): Promise<Version>
  patchVersion(id: string, patch: VersionPatch): Promise<void>
  renameProject(name: string): Promise<void>
  deleteProject(id: string): Promise<void>
  setEnabledLibraries(libraries: string[]): Promise<void>
  setChecks(checks: Check[]): Promise<void>
  setAgentMode(mode: AgentMode): Promise<void>
  setPhotos(photos: ProjectPhoto[]): Promise<void>
  setBrief(brief: string): Promise<void>
  refreshRecent(): Promise<void>
}

let beforeLeave: () => Promise<void> = async () => {}

/** The recorder registers its flush here, so pending edits become a version before the head moves. */
export function onBeforeLeaveHead(fn: (() => Promise<void>) | null): void {
  beforeLeave = fn ?? (async () => {})
}

function loadIntoEditor(version: Version): void {
  const app = useAppStore.getState()
  app.setCode(version.code, 'restore')
  app.setParams(version.params)
}

async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch {
    // Not supported or refused; Settings › Storage and backup shows the state and can ask again.
  }
}

export const currentLibraries = (): string[] => useProjectStore.getState().project?.enabledLibraries ?? []

export const useProjectStore = create<ProjectState>()((set, get) => {
  async function moveHead(target: Version, redoStack: string[]): Promise<void> {
    const project = get().project!
    const updated: Project = { ...project, headVersionId: target.id, updatedAt: Date.now() }
    await putProject(updated)
    set({ project: updated, head: target, redoStack })
    loadIntoEditor(target)
  }

  async function opened(project: Project): Promise<void> {
    await useSettingsStore.getState().update({ lastProjectId: project.id })
    await get().refreshRecent()
  }

  return {
    project: null,
    versions: [],
    head: null,
    redoStack: [],
    recent: [],

    async openProject(id) {
      await beforeLeave()
      const project = await getProject(id)
      if (!project) throw new Error(`Project ${id} not found`)
      const versions = await listVersions(id)
      const head = versions.find((v) => v.id === project.headVersionId) ?? versions.at(-1) ?? null
      set({ project, versions, head, redoStack: [] })
      useAppStore.getState().setLibraries(project.enabledLibraries)
      if (head) loadIntoEditor(head)
      await opened(project)
    },

    async newProject(opts) {
      await beforeLeave()
      const isFirst = (await listRecentProjects(1)).length === 0
      const t = Date.now()
      const draft: Project = {
        id: crypto.randomUUID(),
        name: opts.name ?? UNTITLED,
        createdAt: t,
        updatedAt: t,
        headVersionId: null,
        providerProfileId: null,
        enabledLibraries: opts.enabledLibraries ?? [],
        origin: opts.origin,
        ...(opts.photos ? { photos: opts.photos } : {}),
        ...(opts.brief !== undefined ? { brief: opts.brief } : {}),
        ...(opts.scale ? { scale: opts.scale } : {}),
      }
      await putProject(draft)
      const v1 = await createVersion({
        projectId: draft.id,
        parentId: null,
        code: opts.code,
        params: opts.params ?? {},
        source: opts.source ?? 'manual',
        kind: 'main',
        variantGroupId: null,
        message: opts.message ?? 'New project',
        model: null,
        compileStatus: 'pending',
        renderMs: null,
        thumbnailBlobId: null,
      })
      const project: Project = { ...draft, headVersionId: v1.id }
      await putProject(project)
      set({ project, versions: [v1], head: v1, redoStack: [] })
      useAppStore.getState().setLibraries(project.enabledLibraries)
      loadIntoEditor(v1)
      await opened(project)
      if (isFirst) await requestPersistentStorage()
      return project
    },

    async commit(input) {
      const { project, head } = get()
      if (!project) throw new Error('No project is open')
      const version = await createVersion({
        ...input,
        projectId: project.id,
        parentId: head?.id ?? null,
        kind: 'main',
        variantGroupId: null,
        thumbnailBlobId: null,
      })
      // Re-read: checks or a rename may have been saved while the version was written.
      const latest = get().project?.id === project.id ? get().project! : project
      const updated: Project = { ...latest, headVersionId: version.id, updatedAt: version.createdAt }
      await putProject(updated)
      set((s) => ({ project: s.project?.id === updated.id ? { ...s.project, headVersionId: updated.headVersionId, updatedAt: updated.updatedAt } : s.project, versions: [...s.versions, version], head: version, redoStack: [] }))
      return version
    },

    async patchVersion(id, patch) {
      await updateVersion(id, patch)
      set((s) => ({
        versions: s.versions.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        head: s.head?.id === id ? { ...s.head, ...patch } : s.head,
      }))
    },

    async restore(versionId) {
      await beforeLeave()
      const target = get().versions.find((v) => v.id === versionId)
      if (!target) throw new Error(`Version ${versionId} is not in this project`)
      const head = get().head
      if (head?.id === target.id) return head
      const version = await get().commit({
        code: target.code,
        params: target.params,
        source: 'restore',
        message: `Restored ${target.label}`,
        model: null,
        compileStatus: 'pending',
        renderMs: null,
      })
      loadIntoEditor(version)
      return version
    },

    async branchFrom(versionId) {
      await beforeLeave()
      const target = get().versions.find((v) => v.id === versionId)
      if (!target) throw new Error(`Version ${versionId} is not in this project`)
      await moveHead(target, [])
    },

    async undo() {
      await beforeLeave()
      const { head, versions, redoStack } = get()
      const parent = head?.parentId ? versions.find((v) => v.id === head.parentId) : undefined
      if (!head || !parent) return
      await moveHead(parent, [...redoStack, head.id])
    },

    async redo() {
      await beforeLeave()
      const { head, versions, redoStack } = get()
      const id = redoStack.at(-1)
      const target = id ? versions.find((v) => v.id === id) : undefined
      if (!head || !target || target.parentId !== head.id) {
        if (redoStack.length > 0 && (!target || target.parentId !== head?.id)) set({ redoStack: [] })
        return
      }
      await moveHead(target, redoStack.slice(0, -1))
    },

    async renameProject(name) {
      const project = get().project
      const trimmed = name.trim()
      if (!project || trimmed === '') return
      const updated: Project = { ...project, name: trimmed, updatedAt: Date.now() }
      await putProject(updated)
      set({ project: updated })
      await get().refreshRecent()
    },

    async deleteProject(id) {
      const isCurrent = get().project?.id === id
      if (isCurrent) set({ project: null, versions: [], head: null, redoStack: [] })
      await deleteProjectCascade(id)
      await get().refreshRecent()
      if (!isCurrent) return
      const next = get().recent[0]
      if (next) await get().openProject(next.id)
      else await get().newProject({ code: useAppStore.getState().code, origin: 'blank' })
    },

    async setChecks(checks) {
      const project = get().project
      if (!project) return
      const updated: Project = { ...project, checks, updatedAt: Date.now() }
      set({ project: updated })
      await putProject(updated)
    },

    async setPhotos(photos) {
      const project = get().project
      if (!project) return
      const updated: Project = { ...project, photos, updatedAt: Date.now() }
      set({ project: updated })
      await putProject(updated)
    },

    async setBrief(brief) {
      const project = get().project
      if (!project) return
      const updated: Project = { ...project, brief: brief.slice(0, MAX_BRIEF_CHARS), updatedAt: Date.now() }
      set({ project: updated })
      await putProject(updated)
    },

    async setAgentMode(mode) {
      const project = get().project
      if (!project) return
      const updated: Project = { ...project, agentMode: mode, updatedAt: Date.now() }
      set({ project: updated })
      await putProject(updated)
    },

    async setEnabledLibraries(libraries) {
      const project = get().project
      if (!project) return
      const updated: Project = { ...project, enabledLibraries: libraries, updatedAt: Date.now() }
      // State first: the Libraries switch is controlled, and would flip back while the write is pending.
      set({ project: updated })
      useAppStore.getState().setLibraries(libraries)
      await putProject(updated)
    },

    async refreshRecent() {
      set({ recent: await listRecentProjects(8) })
    },
  }
})
