import { db } from '../db/db'

/** Empties every table of the shared database between tests. */
export async function resetDb(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()))
}
