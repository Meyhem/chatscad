import { db } from '../db/db'

/** Wipes the Dexie singleton and reopens it empty at the current schema version. */
export async function resetDb(): Promise<void> {
  await db.delete()
  await db.open()
}
