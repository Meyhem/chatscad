import type { Version } from '../db/db'
import { errorResult, okResult } from '../test/results'
import { commitPick, compileStatusOf, type CommitPickDeps } from './commitPick'
import { initialSlots, type VariantSlot } from './types'

type NewVersion = Omit<Version, 'id' | 'label' | 'createdAt'>

function fakes() {
  const created: NewVersion[] = []
  const calls: string[] = []
  const deps: CommitPickDeps = {
    createVersion: vi.fn(async (input: NewVersion) => {
      created.push(input)
      calls.push(`create ${input.kind} ${input.code}`)
      return { ...input, id: `id-${created.length}`, label: `v${created.length}`, createdAt: created.length }
    }),
    setHead: vi.fn(async (projectId: string, versionId: string) => {
      calls.push(`head ${projectId} ${versionId}`)
    }),
    openProject: vi.fn(async (projectId: string) => {
      calls.push(`open ${projectId}`)
    }),
  }
  return { created, calls, deps }
}

function slots(): VariantSlot[] {
  const [a, b, c] = initialSlots('fake-model', [undefined, 0.7, 1.0])
  return [
    { ...a, status: 'ok', code: 'A', result: okResult(), resultCode: 'A' },
    { ...b, status: 'error', code: 'B', result: errorResult(), resultCode: 'B' },
    // Picked while C's auto-fix was still rendering: its newest code never rendered.
    { ...c, status: 'queued', code: 'C2', result: errorResult(), resultCode: 'C1' },
  ]
}

const input = { projectId: 'project-1', parentId: 'version-3', groupId: 'group-1', prompt: 'A hook' }

it('stores the pick as the main version, the others as variants of the same group, then moves the head', async () => {
  const f = fakes()
  const pick = await commitPick({ ...input, slots: slots(), picked: 0 }, f.deps)

  expect(f.calls).toEqual(['create main A', 'create variant B', 'create variant C2', 'head project-1 id-1', 'open project-1'])
  expect(pick.id).toBe('id-1')
  expect(f.created[0]).toEqual({
    projectId: 'project-1',
    parentId: 'version-3',
    code: 'A',
    params: {},
    source: 'ai',
    kind: 'main',
    variantGroupId: 'group-1',
    message: 'A hook',
    model: 'fake-model',
    compileStatus: 'ok',
    renderMs: 12,
    thumbnailBlobId: null,
  })
  expect(f.created.map((v) => [v.kind, v.variantGroupId, v.parentId, v.compileStatus])).toEqual([
    ['main', 'group-1', 'version-3', 'ok'],
    ['variant', 'group-1', 'version-3', 'error'],
    ['variant', 'group-1', 'version-3', 'pending'],
  ])
  expect(f.created[2].renderMs).toBeNull()
})

it('does not store slots without code', async () => {
  const f = fakes()
  const s = slots()
  s[1] = { ...s[1], status: 'failed-request', code: null, result: null, resultCode: null }
  await commitPick({ ...input, slots: s, picked: 0 }, f.deps)
  expect(f.created.map((v) => v.code)).toEqual(['A', 'C2'])
})

it('refuses without a project or code', async () => {
  const f = fakes()
  await expect(commitPick({ ...input, projectId: null, slots: slots(), picked: 0 }, f.deps)).rejects.toThrow('No project is open')
  const s = slots()
  s[0] = { ...s[0], code: null }
  await expect(commitPick({ ...input, slots: s, picked: 0 }, f.deps)).rejects.toThrow('Variant A has no code')
  expect(f.created).toEqual([])
})

it('derives compile status from the code that rendered', () => {
  const [a] = slots()
  expect(compileStatusOf(a)).toBe('ok')
  expect(compileStatusOf({ ...a, resultCode: 'other' })).toBe('pending')
  expect(compileStatusOf({ ...a, result: null })).toBe('pending')
})
