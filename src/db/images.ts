import { db, type ChatScadDb } from './db'

/** Images attached to prompts, stored with the message (and so the version) that used them. */
export async function saveImage(blob: Blob, database: ChatScadDb = db): Promise<string> {
  const id = crypto.randomUUID()
  await database.blobs.put({ id, kind: 'image', data: blob })
  return id
}

export async function loadImage(id: string, database: ChatScadDb = db): Promise<Blob | null> {
  const row = await database.blobs.get(id)
  return row?.kind === 'image' ? row.data : null
}
