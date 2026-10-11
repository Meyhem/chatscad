import { db, type StoredBlob } from './db'

export async function putBlob(kind: StoredBlob['kind'], data: Blob): Promise<string> {
  const id = crypto.randomUUID()
  await db.blobs.add({ id, kind, data })
  return id
}

export const getBlob = (id: string): Promise<StoredBlob | undefined> => db.blobs.get(id)
