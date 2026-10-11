import { countLineChanges, sideBySide, type DiffRow } from './diff'
import { bakeMessage, describeParamChanges, formatValue, manualMessage, truncate } from './messages'

const lines = (n: number, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join('\n') + '\n'

const show = (rows: DiffRow[]) =>
  rows.map((r) =>
    r.kind === 'skip'
      ? `skip ${r.count}`
      : `${r.left ? `${r.left.kind}:${r.left.line}:${r.left.text}` : '-'} | ${r.right ? `${r.right.kind}:${r.right.line}:${r.right.text}` : '-'}`,
  )

describe('sideBySide', () => {
  it('pairs removed and added lines and counts them', () => {
    const { rows, added, removed } = sideBySide('a\nb\nc\nd\n', 'a\nB\nc\nd\nE\n')
    expect(show(rows)).toEqual([
      'same:1:a | same:1:a',
      'del:2:b | add:2:B',
      'same:3:c | same:3:c',
      'same:4:d | same:4:d',
      '- | add:5:E',
    ])
    expect({ added, removed }).toEqual({ added: 2, removed: 1 })
  })

  it('pads an uneven change with empty cells on the shorter side', () => {
    expect(show(sideBySide('x\ny\nz\n', 'x\nY\n').rows)).toEqual(['same:1:x | same:1:x', 'del:2:y | add:2:Y', 'del:3:z | -'])
  })

  it('collapses long unchanged runs, keeping three lines of context around each change', () => {
    const oldCode = lines(20)
    const newCode = oldCode.replace('l10\n', 'ten\n')
    const out = show(sideBySide(oldCode, newCode).rows)
    expect(out).toEqual([
      'skip 6',
      'same:7:l7 | same:7:l7',
      'same:8:l8 | same:8:l8',
      'same:9:l9 | same:9:l9',
      'del:10:l10 | add:10:ten',
      'same:11:l11 | same:11:l11',
      'same:12:l12 | same:12:l12',
      'same:13:l13 | same:13:l13',
      'skip 7',
    ])
  })

  it('shows identical code as one collapsed run', () => {
    expect(sideBySide(lines(5), lines(5))).toEqual({ rows: [{ kind: 'skip', count: 5 }], added: 0, removed: 0 })
  })

  it('ignores a missing newline at the end of the file', () => {
    expect(countLineChanges('a\nb', 'a\nb\n')).toEqual({ added: 0, removed: 0 })
    expect(countLineChanges('a\nb\n', 'a\nc\nd\n')).toEqual({ added: 2, removed: 1 })
  })
})

describe('version messages', () => {
  it('describes parameter changes with arrows, up to three', () => {
    expect(describeParamChanges({ height: 18, wall: 2 }, { height: 22, wall: 2 })).toBe('height 18 → 22')
    expect(describeParamChanges({ a: 1, b: 'x', c: true, d: [1, 2] }, { a: 2, b: 'y', c: false, d: [1, 3] })).toBe(
      'a 1 → 2, b x → y, c true → false and 1 more',
    )
    expect(describeParamChanges({ a: 1 }, { a: 1 })).toBe('Parameters unchanged')
    expect(describeParamChanges({}, { size: [1, 2] })).toBe('size [1, 2]')
  })

  it('summarises manual edits, bakes, and long text', () => {
    expect(manualMessage('a\nb\n', 'a\nc\nd\n')).toBe('Edited code · +2 −1 lines')
    expect(bakeMessage(['height', 'wall'])).toBe('Baked height, wall into code')
    expect(bakeMessage([])).toBe('Baked parameters into code')
    expect(truncate('  first line\nsecond')).toBe('first line')
    expect(truncate('x'.repeat(130))).toBe(`${'x'.repeat(119)}…`)
    expect(formatValue([1, 2.5])).toBe('[1, 2.5]')
  })
})
