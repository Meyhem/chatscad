import type { Version } from '../db/db'
import { makeVersion } from '../test/fixtures'
import { buildTimeline, formatAge, timelineCaption } from './timeline'

const v = (id: string, parentId: string | null, createdAt: number, over: Partial<Version> = {}) =>
  makeVersion({ id, label: id, parentId, createdAt, ...over })

const screenVersions = [
  v('v1', null, 1),
  v('v2', 'v1', 2),
  v('v3', 'v2', 3),
  v('v3.1', 'v3', 4),
  v('v4', 'v3', 5, { compileStatus: 'error' }),
  v('v5', 'v4', 6),
  v('v6', 'v5', 7, { variantGroupId: 'g1' }),
  v('v6.1', 'v5', 8, { kind: 'variant', variantGroupId: 'g1' }),
  v('v6.2', 'v5', 9, { kind: 'variant', variantGroupId: 'g1' }),
]

it('orders the trunk newest first with each branch under its parent, as on the History screen', () => {
  const t = buildTimeline(screenVersions, 'v6')
  expect(t.rows.map((r) => `${r.version.label}${r.branch ? ' branch' : ''}${r.isHead ? ' head' : ''}`)).toEqual([
    'v6 head', 'v5', 'v4', 'v3', 'v3.1 branch', 'v2', 'v1',
  ])
  expect(t.rows[0]!.variantsNotPicked).toBe(2)
  expect(t.count).toBe(7)
  expect(t.branches).toBe(1)
  expect(timelineCaption(t)).toBe('7 versions · 1 branch')
})

it('keeps newer versions on the trunk after an undo moved the head back', () => {
  const versions = [v('v1', null, 1), v('v2', 'v1', 2), v('v3', 'v2', 3)]
  expect(buildTimeline(versions, 'v2').rows.map((r) => `${r.version.label}${r.isHead ? ' head' : ''}`)).toEqual(['v3', 'v2 head', 'v1'])
})

it('follows the head into a branch and shows deeper branch versions newest first', () => {
  const versions = [v('v1', null, 1), v('v2', 'v1', 2), v('v1.1', 'v1', 3), v('v1.2', 'v1.1', 4), v('v3', 'v2', 5)]
  expect(buildTimeline(versions, 'v1.2').rows.map((r) => `${r.version.label}${r.branch ? ' branch' : ''}`)).toEqual([
    'v1.2', 'v1.1', 'v1', 'v3 branch', 'v2 branch',
  ])
})

it('formats ages and captions in the design voice', () => {
  expect(formatAge(20_000)).toBe('now')
  expect(formatAge(4 * 60_000)).toBe('4 min')
  expect(formatAge(3 * 3_600_000)).toBe('3 h')
  expect(formatAge(2 * 86_400_000)).toBe('2 d')
  expect(timelineCaption({ rows: [], count: 1, branches: 0 })).toBe('1 version')
  expect(timelineCaption({ rows: [], count: 3, branches: 2 })).toBe('3 versions · 2 branches')
})
