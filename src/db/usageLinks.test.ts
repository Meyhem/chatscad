// @vitest-environment node
import 'fake-indexeddb/auto'
import { resetDb } from '../test/resetDb'
import { db, type UsageRecord } from './db'
import { installUsageHook, linkUsage, takePendingUsageIds, usageByIds, usageForVersion } from './usageLinks'

const row = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  id: crypto.randomUUID(),
  profileId: 'p',
  model: 'm',
  inputTokens: 100,
  outputTokens: 20,
  cost: 0.001,
  costSource: 'provider',
  createdAt: 1,
  projectId: null,
  versionId: null,
  ...over,
})

beforeEach(resetDb)

it('tags new usage rows with the open project and links them to a version later', async () => {
  let project: string | null = 'proj-1'
  const uninstall = installUsageHook(() => project)
  const a = row()
  const b = row({ projectId: 'explicit' })
  await db.usage.add(a)
  await db.usage.add(b)
  expect((await db.usage.get(a.id))?.projectId).toBe('proj-1')
  expect((await db.usage.get(b.id))?.projectId).toBe('explicit')

  const ids = takePendingUsageIds()
  expect(ids).toEqual([a.id, b.id])
  expect(takePendingUsageIds()).toEqual([])
  await linkUsage(ids, 'v9')
  expect((await usageForVersion('v9')).map((u) => u.id).sort()).toEqual([a.id, b.id].sort())
  expect((await usageByIds([a.id, 'missing'])).map((u) => u.id)).toEqual([a.id])

  uninstall()
  project = 'proj-2'
  const c = row()
  await db.usage.add(c)
  expect((await db.usage.get(c.id))?.projectId).toBeNull()
  expect(takePendingUsageIds()).toEqual([])
})
