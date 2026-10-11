import { db, type StoredMessage } from './db'

export async function putMessage(m: StoredMessage): Promise<void> {
  await db.messages.put(m)
}

export const listMessages = (projectId: string): Promise<StoredMessage[]> =>
  db.messages.where('projectId').equals(projectId).sortBy('createdAt')

export const messagesForVersion = (versionId: string): Promise<StoredMessage[]> =>
  db.messages.where('versionId').equals(versionId).sortBy('createdAt')
