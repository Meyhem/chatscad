// @vitest-environment node
import 'fake-indexeddb/auto'
import { db, type Version } from '../db/db'
import { makeVersion } from '../test/fixtures'
import { resetDb } from '../test/resetDb'
import { ancestry, createVersion, getVersion, listVersions, nextLabel, updateVersion } from './versions'

beforeEach(resetDb)

const v = (label: string) => makeVersion({ id: label, label })

const input = (parentId: string | null, over: Partial<Version> = {}): Omit<Version, 'id' | 'label' | 'createdAt'> => ({
  projectId: 'p1',
  parentId,
  code: 'cube(1);',
  params: {},
  source: 'manual',
  kind: 'main',
  variantGroupId: null,
  message: '',
  model: null,
  compileStatus: 'ok',
  renderMs: 5,
  thumbnailBlobId: null,
  ...over,
})

async function chain(n: number): Promise<Version[]> {
  const out: Version[] = []
  for (let i = 0; i < n; i++) out.push(await createVersion(input(out.at(-1)?.id ?? null)))
  return out
}

describe('nextLabel', () => {
  it('numbers the main line and branches', () => {
    expect(nextLabel(null, [])).toBe('v1')
    expect(nextLabel(v('v3'), [])).toBe('v4')
    expect(nextLabel(v('v3'), [v('v4')])).toBe('v3.1')
    expect(nextLabel(v('v3'), [v('v4'), v('v3.1')])).toBe('v3.2')
    expect(nextLabel(v('v3.1'), [])).toBe('v3.2')
    expect(nextLabel(v('v3.1'), [v('v3.2')])).toBe('v3.1.1')
  })
})

describe('createVersion', () => {
  it('builds the main line v1, v2, v3 with ids and strictly increasing times', async () => {
    const [a, b, c] = await chain(3)
    expect([a!.label, b!.label, c!.label]).toEqual(['v1', 'v2', 'v3'])
    expect(new Set([a!.id, b!.id, c!.id]).size).toBe(3)
    expect(a!.createdAt).toBeLessThan(b!.createdAt)
    expect(b!.createdAt).toBeLessThan(c!.createdAt)
    expect(await db.versions.count()).toBe(3)
  })

  it('labels branches v3.1, v3.2 and moves a clashing continuation to v3.1.1', async () => {
    const [, , v3] = await chain(4)
    const b1 = await createVersion(input(v3!.id))
    const b2 = await createVersion(input(v3!.id))
    const b1child = await createVersion(input(b1.id))
    expect([b1.label, b2.label, b1child.label]).toEqual(['v3.1', 'v3.2', 'v3.1.1'])
  })

  it('moves a second branch past a label its sibling branch already took', async () => {
    const [, , v3] = await chain(4)
    const b1 = await createVersion(input(v3!.id))
    const b1child = await createVersion(input(b1.id))
    const b2 = await createVersion(input(v3!.id))
    expect([b1.label, b1child.label, b2.label]).toEqual(['v3.1', 'v3.2', 'v3.3'])
    const labels = (await listVersions('p1')).map((x) => x.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('refuses a parent that is not in the project', async () => {
    const [a] = await chain(1)
    await expect(createVersion(input(a!.id, { projectId: 'p2' }))).rejects.toThrow(`Parent version ${a!.id} is not in project p2`)
  })
})

it('lists a project oldest first, walks the ancestry head first, and patches status fields', async () => {
  const [a, b, c] = await chain(3)
  await createVersion(input(null, { projectId: 'p2' }))
  expect((await listVersions('p1')).map((x) => x.label)).toEqual(['v1', 'v2', 'v3'])
  expect((await ancestry(c!.id)).map((x) => x.id)).toEqual([c!.id, b!.id, a!.id])
  expect(await ancestry('missing')).toEqual([])

  await updateVersion(b!.id, { compileStatus: 'error', renderMs: 42, thumbnailBlobId: 't1' })
  expect(await getVersion(b!.id)).toMatchObject({ compileStatus: 'error', renderMs: 42, thumbnailBlobId: 't1', label: 'v2' })
})
