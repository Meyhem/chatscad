import { db, type Project } from './db'

export async function putProject(p: Project): Promise<void> {
  await db.projects.put(p)
}

export const getProject = (id: string): Promise<Project | undefined> => db.projects.get(id)

export const listRecentProjects = (limit = 8): Promise<Project[]> => db.projects.orderBy('updatedAt').reverse().limit(limit).toArray()

export const listAllProjects = (): Promise<Project[]> => db.projects.orderBy('updatedAt').reverse().toArray()

export async function deleteProjectCascade(id: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.versions, db.messages, db.presets, db.blobs], async () => {
    const versions = await db.versions.where('projectId').equals(id).toArray()
    const messages = await db.messages.where('projectId').equals(id).toArray()
    const blobIds = [
      ...versions.flatMap((v) => (v.thumbnailBlobId ? [v.thumbnailBlobId] : [])),
      ...messages.flatMap((m) => m.imageBlobIds),
    ]
    await db.blobs.bulkDelete(blobIds)
    await db.versions.where('projectId').equals(id).delete()
    await db.messages.where('projectId').equals(id).delete()
    await db.presets.where('projectId').equals(id).delete()
    await db.projects.delete(id)
  })
}
