import type { Version } from '../db/db'
import { useProjectStore } from '../history/projectStore'
import { setHead } from '../history/setHead'
import { createVersion } from '../history/versions'
import type { VariantSlot } from './types'

export interface CommitPickInput {
  projectId: string | null
  parentId: string | null
  groupId: string
  prompt: string
  slots: VariantSlot[]
  picked: number
}

export interface CommitPickDeps {
  createVersion: typeof createVersion
  setHead(projectId: string, versionId: string): Promise<void>
  openProject(projectId: string): Promise<void>
}

const defaultDeps: CommitPickDeps = {
  createVersion,
  setHead: (projectId, versionId) => setHead(projectId, versionId),
  openProject: async (projectId) => {
    await useProjectStore.getState().openProject(projectId)
  },
}

/** 'ok'/'error' only when the stored code is the code that rendered. */
export function compileStatusOf(slot: VariantSlot): Version['compileStatus'] {
  if (!slot.result || slot.resultCode !== slot.code) return 'pending'
  return slot.result.ok ? 'ok' : 'error'
}

export async function commitPick(input: CommitPickInput, deps: CommitPickDeps = defaultDeps): Promise<Version> {
  const { projectId, parentId, groupId, prompt, slots, picked } = input
  if (!projectId) throw new Error('No project is open')
  const chosen = slots[picked]
  if (!chosen?.code) throw new Error(`Variant ${chosen?.letter ?? picked + 1} has no code`)

  const fields = (slot: VariantSlot, code: string, kind: Version['kind']) => ({
    projectId,
    parentId,
    code,
    params: {},
    source: 'ai' as const,
    kind,
    variantGroupId: groupId,
    message: prompt,
    model: slot.model,
    compileStatus: compileStatusOf(slot),
    renderMs: slot.resultCode === slot.code ? (slot.result?.renderMs ?? null) : null,
    thumbnailBlobId: null,
  })

  const pick = await deps.createVersion(fields(chosen, chosen.code, 'main'))
  for (const [i, slot] of slots.entries()) {
    if (i !== picked && slot.code !== null) await deps.createVersion(fields(slot, slot.code, 'variant'))
  }
  await deps.setHead(projectId, pick.id)
  await deps.openProject(projectId)
  return pick
}
