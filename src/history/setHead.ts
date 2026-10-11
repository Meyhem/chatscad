import { db as defaultDb, type ChatScadDb } from '../db/db'

/** Points the project at an existing version; unlike restore(), it creates no new version. */
export async function setHead(projectId: string, versionId: string, database: ChatScadDb = defaultDb): Promise<void> {
  const updated = await database.projects.update(projectId, { headVersionId: versionId, updatedAt: Date.now() })
  if (updated === 0) throw new Error(`Project ${projectId} was not found`)
}
