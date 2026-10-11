import { db as defaultDb, type ChatScadDb, type UsageRecord } from '../db/db'

/** One usage row per variant reply (the chat path writes its own through M2's repository). */
export async function recordUsage(record: Omit<UsageRecord, 'id' | 'createdAt'>, database: ChatScadDb = defaultDb): Promise<void> {
  await database.usage.put({ ...record, id: crypto.randomUUID(), createdAt: Date.now() })
}
