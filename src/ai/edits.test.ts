// @vitest-environment node
import { applyEdits, parseReply } from './edits'

describe('parseReply', () => {
  it('takes a full file from an openscad fence and keeps the prose', () => {
    const r = parseReply('Made a 4-slot holder.\n\n```openscad\ncube(10);\n```\n\nSlot count is a parameter.')
    expect(r).toEqual({ kind: 'full', code: 'cube(10);\n', prose: 'Made a 4-slot holder.\n\nSlot count is a parameter.' })
  })

  it('accepts a scad fence and uses the last OpenSCAD fence when there are several', () => {
    const r = parseReply('Old:\n```scad\ncube(1);\n```\nNew:\n```openscad\ncube(2);\n```')
    expect(r).toMatchObject({ kind: 'full', code: 'cube(2);\n', prose: 'Old:\n\nNew:' })
  })

  it('falls back to an untagged fence, but never to a fence in another language', () => {
    expect(parseReply('```\nsphere(5);\n```')).toMatchObject({ kind: 'full', code: 'sphere(5);\n' })
    expect(parseReply('Run this:\n```python\nprint(1)\n```')).toEqual({ kind: 'none', prose: 'Run this:\n```python\nprint(1)\n```' })
  })

  it('ignores an unclosed fence (a reply cut off mid-file)', () => {
    expect(parseReply('Here:\n```openscad\ncube(1);')).toMatchObject({ kind: 'none' })
  })

  it('parses SEARCH/REPLACE blocks in order and removes them from the prose', () => {
    const text = [
      'Set wall to 2.4 and added a chamfer.',
      '',
      '<<<<<<< SEARCH',
      'wall = 2;',
      '=======',
      'wall = 2.4;',
      '>>>>>>> REPLACE',
      '',
      '<<<<<<< SEARCH',
      'body();',
      '=======',
      'body();',
      'chamfer();',
      '>>>>>>> REPLACE',
    ].join('\n')
    expect(parseReply(text)).toEqual({
      kind: 'edits',
      edits: [
        { search: 'wall = 2;', replace: 'wall = 2.4;' },
        { search: 'body();', replace: 'body();\nchamfer();' },
      ],
      prose: 'Set wall to 2.4 and added a chamfer.',
    })
  })

  it('accepts blocks wrapped in a fence, CRLF line endings, and an empty replacement', () => {
    const text = 'Removed the lid.\r\n```\r\n<<<<<<< SEARCH\r\nlid();\r\n=======\r\n>>>>>>> REPLACE\r\n```\r\n'
    expect(parseReply(text)).toEqual({ kind: 'edits', edits: [{ search: 'lid();', replace: '' }], prose: 'Removed the lid.' })
  })

  it('returns prose only when there is no code', () => {
    expect(parseReply('  Which cell size do you mean?  ')).toEqual({ kind: 'none', prose: 'Which cell size do you mean?' })
  })
})

describe('applyEdits', () => {
  const code = 'wall = 2;\nheight = 22;\n\nbody();\n'

  it('applies edits in order', () => {
    expect(
      applyEdits(code, [
        { search: 'wall = 2;', replace: 'wall = 2.4;' },
        { search: 'wall = 2.4;\nheight = 22;', replace: 'wall = 2.4;\nheight = 30;' },
      ]),
    ).toEqual({ ok: true, code: 'wall = 2.4;\nheight = 30;\n\nbody();\n' })
  })

  it('fails on the first edit whose search text is missing, changing nothing', () => {
    expect(applyEdits(code, [{ search: 'wall = 2;', replace: 'x' }, { search: 'depth = 9;', replace: 'y' }])).toEqual({
      ok: false,
      failedIndex: 1,
    })
  })

  it('fails when the search text occurs more than once', () => {
    expect(applyEdits('cube(1);\ncube(1);\n', [{ search: 'cube(1);', replace: 'cube(2);' }])).toEqual({ ok: false, failedIndex: 0 })
  })

  it('fails on an empty search', () => {
    expect(applyEdits(code, [{ search: '', replace: 'x' }])).toEqual({ ok: false, failedIndex: 0 })
  })

  it('normalises CRLF in the code and in the edits', () => {
    expect(applyEdits('a = 1;\r\nb = 2;\r\n', [{ search: 'a = 1;\r\nb = 2;', replace: 'a = 3;\r\nb = 4;' }])).toEqual({
      ok: true,
      code: 'a = 3;\nb = 4;\n',
    })
  })

  it('keeps $ sequences in replacements literally', () => {
    expect(applyEdits('cylinder(r = 5);\n', [{ search: 'cylinder(r = 5);', replace: 'cylinder(r = 5, $fn = 64); // $& $1 $$' }])).toEqual({
      ok: true,
      code: 'cylinder(r = 5, $fn = 64); // $& $1 $$\n',
    })
  })
})
