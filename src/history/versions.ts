import { db, type Version } from '../db/db'

export type VersionPatch = Partial<Pick<Version, 'compileStatus' | 'renderMs' | 'thumbnailBlobId'>>

let lastCreatedAt = 0
/** Date.now(), strictly increasing within the session so versions made in the same millisecond stay ordered. */
function now(): number {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1)
  return lastCreatedAt
}

function bump(label: string): string {
  const parts = label.slice(1).split('.')
  parts[parts.length - 1] = String(Number(parts.at(-1)) + 1)
  return `v${parts.join('.')}`
}

/** "v4" after "v3"; "v3.1" for a second child of v3; "v3.2" after "v3.1". */
export function nextLabel(parent: Version | null, siblings: Version[]): string {
  if (!parent) return 'v1'
  if (siblings.length === 0) return bump(parent.label)
  return `${parent.label}.${siblings.length}`
}

function uniqueLabel(candidate: string, parent: Version | null, siblings: Version[], taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate
  const base = parent?.label ?? 'v1'
  for (let k = Math.max(1, siblings.length); ; k++) {
    const label = `${base}.${k}`
    if (!taken.has(label)) return label
  }
}

export async function createVersion(input: Omit<Version, 'id' | 'label' | 'createdAt'>): Promise<Version> {
  return db.transaction('rw', db.versions, async () => {
    const all = await db.versions.where('projectId').equals(input.projectId).toArray()
    const parent = input.parentId === null ? null : (all.find((v) => v.id === input.parentId) ?? null)
    if (input.parentId !== null && !parent) throw new Error(`Parent version ${input.parentId} is not in project ${input.projectId}`)
    const siblings = all.filter((v) => v.parentId === input.parentId)
    const label = uniqueLabel(nextLabel(parent, siblings), parent, siblings, new Set(all.map((v) => v.label)))
    const version: Version = { ...input, id: crypto.randomUUID(), label, createdAt: now() }
    await db.versions.add(version)
    return version
  })
}

export const getVersion = (id: string): Promise<Version | undefined> => db.versions.get(id)

export const listVersions = (projectId: string): Promise<Version[]> => db.versions.where('projectId').equals(projectId).sortBy('createdAt')

/** The version and its parents, head first. */
export async function ancestry(versionId: string): Promise<Version[]> {
  const out: Version[] = []
  const seen = new Set<string>()
  let id: string | null = versionId
  while (id !== null && !seen.has(id)) {
    seen.add(id)
    const v: Version | undefined = await db.versions.get(id)
    if (!v) break
    out.push(v)
    id = v.parentId
  }
  return out
}

export async function updateVersion(id: string, patch: VersionPatch): Promise<void> {
  await db.versions.update(id, patch)
}
