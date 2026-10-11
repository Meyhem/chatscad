import { db, type UsageRecord } from './db'

let pending: string[] = []

/**
 * M2 writes usage rows with projectId null. This hook fills in the open project and remembers each new row,
 * so the version recorded for the turn can claim it (linkUsage).
 */
export function installUsageHook(getProjectId: () => string | null): () => void {
  const hook = (_primKey: unknown, obj: UsageRecord): void => {
    if (obj.projectId === null) obj.projectId = getProjectId()
    pending.push(obj.id)
  }
  db.usage.hook('creating', hook)
  return () => {
    db.usage.hook('creating').unsubscribe(hook)
    pending = []
  }
}

export function takePendingUsageIds(): string[] {
  const ids = pending
  pending = []
  return ids
}

export function clearPendingUsage(): void {
  pending = []
}

export async function linkUsage(ids: string[], versionId: string): Promise<void> {
  if (ids.length > 0) await db.usage.where(':id').anyOf(ids).modify({ versionId })
}

export async function usageByIds(ids: string[]): Promise<UsageRecord[]> {
  return (await db.usage.bulkGet(ids)).filter((u): u is UsageRecord => u !== undefined)
}

export const usageForVersion = (versionId: string): Promise<UsageRecord[]> => db.usage.where('versionId').equals(versionId).toArray()
