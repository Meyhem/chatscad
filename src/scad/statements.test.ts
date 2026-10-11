import {
  formatLines,
  listModuleDefinitions,
  listTaggableStatements,
  resolveEditScope,
  statementKind,
} from './statements'

const HOLDER = [
  '/* [Size] */', //                         1
  'slots = 4; // [1:8]', //                  2
  '$fn = 48;', //                            3
  'include <lib/parts.scad>', //             4
  'use <other.scad>', //                     5
  '', //                                     6
  'module body() {', //                      7
  '  difference() {', //                     8
  '    cube([40, 20, 10]);', //              9
  '    for (i = [0 : slots - 1])', //        10
  '      translate([5 + i * 10, 10, 2])', // 11
  '        cylinder(h = 10, d = 6);', //     12
  '  }', //                                  13
  '}', //                                    14
  '', //                                     15
  'function pitch(n) = n * 10;', //          16
  'echo("pitch", pitch(2));', //             17
  '*sphere(50);', //                         18
  'body();', //                              19
  'translate([0, -5, 0])', //                20
  '  cube([40, 2, 2]); // rail', //          21
].join('\n')

const ASSEMBLY = [
  'module plate() { cube([40, 40, 10]); }', //                         1
  'module peg() { translate([15, 15, 10]) cube([10, 10, 10]); }', //   2
  'difference() {', //                                                 3
  '  plate();', //                                                     4
  '  // the bores }', //                                               5
  '  for (i = [0 : 3])', //                                            6
  '    translate([5 + i * 10, 5, -1])', //                             7
  '      cylinder(h = 12, d = 3);', //                                 8
  '  #peg();', //                                                      9
  '}', //                                                              10
].join('\n')

describe('listTaggableStatements', () => {
  it('lists top-level geometry and skips definitions, assignments, includes, echo and disabled statements', () => {
    const railStart = HOLDER.indexOf('translate([0, -5')
    const railEnd = HOLDER.indexOf('2]); // rail') + 4
    expect(listTaggableStatements(HOLDER)).toEqual([
      { tag: 1, label: 'body', startLine: 19, endLine: 19, start: HOLDER.indexOf('body();'), end: HOLDER.indexOf('body();') + 7 },
      { tag: 2, label: 'cube', startLine: 20, endLine: 21, start: railStart, end: railEnd },
    ])
  })

  it('lists the children of a top-level boolean instead of the boolean, with modifiers inside the range', () => {
    const statements = listTaggableStatements(ASSEMBLY)
    expect(statements.map(({ tag, label, startLine, endLine }) => ({ tag, label, startLine, endLine }))).toEqual([
      { tag: 1, label: 'plate', startLine: 4, endLine: 4 },
      { tag: 2, label: 'for loop', startLine: 6, endLine: 8 },
      { tag: 3, label: 'peg', startLine: 9, endLine: 9 },
    ])
    expect(ASSEMBLY.slice(statements[2].start, statements[2].end)).toBe('#peg();')
  })

  it('keeps an empty boolean as one statement', () => {
    expect(listTaggableStatements('difference() {}\n').map((s) => s.label)).toEqual(['difference'])
  })

  it('does not expand booleans below the top level', () => {
    const code = 'difference() {\n  union() { cube(5); sphere(3); }\n  cylinder(h = 9, r = 1);\n}\n'
    expect(listTaggableStatements(code).map((s) => [s.label, s.startLine])).toEqual([
      ['union', 2],
      ['cylinder', 3],
    ])
  })

  it('treats if/else as one statement and labels it', () => {
    expect(listTaggableStatements('if (big) cube(10); else sphere(2);\n')).toMatchObject([
      { tag: 1, label: 'if block', startLine: 1, endLine: 1 },
    ])
  })

  it('ignores brackets and semicolons inside strings and comments', () => {
    const code = 'text("a;b}{", size = 5); // ) ; {\ncube(1);\n'
    expect(listTaggableStatements(code).map((s) => s.label)).toEqual(['text', 'cube'])
  })

  it('labels by the user module, else the first non-transform call', () => {
    const code = 'module part() cube(1);\ncolor("red") translate([1, 0, 0]) part();\nrotate([0, 0, 45]) linear_extrude(3) square(4);\n'
    expect(listTaggableStatements(code).map((s) => s.label)).toEqual(['part', 'linear_extrude'])
  })

  it('still lists a final statement without a semicolon', () => {
    expect(listTaggableStatements('cube(1);\nsphere(2)').map((s) => s.label)).toEqual(['cube', 'sphere'])
  })

  it('returns nothing for code without geometry', () => {
    expect(listTaggableStatements('// nothing\nw = 3;\necho(w);\n')).toEqual([])
  })
})

describe('module definitions and edit scopes', () => {
  it('lists module definitions with their lines', () => {
    expect(listModuleDefinitions(HOLDER).map(({ name, startLine, endLine }) => ({ name, startLine, endLine }))).toEqual([
      { name: 'body', startLine: 7, endLine: 14 },
    ])
  })

  it('scopes a call to a module used once to the module definition', () => {
    const [plate, loop, peg] = listTaggableStatements(ASSEMBLY)
    expect(resolveEditScope(ASSEMBLY, plate)).toEqual({ startLine: 1, endLine: 1 })
    expect(resolveEditScope(ASSEMBLY, peg)).toEqual({ startLine: 2, endLine: 2 })
    expect(resolveEditScope(ASSEMBLY, loop)).toEqual({ startLine: 6, endLine: 8 })
    expect(resolveEditScope(HOLDER, listTaggableStatements(HOLDER)[0])).toEqual({ startLine: 7, endLine: 14 })
  })

  it('scopes a call to a module used more than once to the call itself', () => {
    const code = 'module m() cube(1);\nm();\ntranslate([5, 0, 0]) m();\n'
    const [first, second] = listTaggableStatements(code)
    expect(resolveEditScope(code, first)).toEqual({ startLine: 2, endLine: 2 })
    expect(resolveEditScope(code, second)).toEqual({ startLine: 3, endLine: 3 })
  })

  it('names the kind of a statement for the popover', () => {
    const [plate, loop] = listTaggableStatements(ASSEMBLY)
    expect(statementKind(ASSEMBLY, plate)).toBe('module call')
    expect(statementKind(ASSEMBLY, loop)).toBe('for loop')
    expect(statementKind('cylinder(h = 2, r = 1);', listTaggableStatements('cylinder(h = 2, r = 1);')[0])).toBe('cylinder')
  })
})

describe('formatLines', () => {
  it('uses the singular for one line and an en dash for a range', () => {
    expect(formatLines({ startLine: 2, endLine: 2 })).toBe('line 2')
    expect(formatLines({ startLine: 15, endLine: 17 })).toBe('lines 15–17')
  })
})
