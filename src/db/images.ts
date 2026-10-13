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

/** Deletes the given images unless a message of the project still shows them; other blob kinds are left alone. */
export async function deleteUnreferencedImages(projectId: string | null, ids: readonly string[], database: ChatScadDb = db): Promise<void> {
  if (ids.length === 0) return
  await database.transaction('rw', [database.messages, database.blobs], async () => {
    const messages = projectId === null ? [] : await database.messages.where('projectId').equals(projectId).toArray()
    const referenced = new Set(messages.flatMap((m) => m.imageBlobIds ?? []))
    const rows = await database.blobs.bulkGet(ids.filter((id) => !referenced.has(id)))
    await database.blobs.bulkDelete(rows.flatMap((r) => (r?.kind === 'image' ? [r.id] : [])))
  })
}
