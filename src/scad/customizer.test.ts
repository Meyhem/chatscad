import { bakeParams, effectiveValues, paramOverrides, parseCustomizer } from './customizer'

const byName = (code: string) => Object.fromEntries(parseCustomizer(code).map((p) => [p.name, p]))

describe('controls from the spec table', () => {
  const code = [
    'w = 40; // [10:1:200]',
    'h = 12; // [10:200]',
    'r = 1.5; // [0.5:3]',
    'm = 30; // [50]',
    't = 2; // 0.5',
    'shape = "round"; // [round, square]',
    'size_name = "M"; // [S:Small, M:Medium]',
    'teeth = 2; // [1:One, 2:Two]',
    'pa = 20; // [14.5, 20, 25]',
    'holes = true;',
    'label = "ABC";',
    'size = [20, 30, 5];',
    'n = 7;',
  ].join('\n')
  const p = byName(code)

  it('builds sliders from [min:step:max], [min:max] and [max]', () => {
    expect(p.w).toMatchObject({ defaultValue: 40, control: { kind: 'slider', min: 10, step: 1, max: 200 }, annotated: true, line: 1 })
    expect(p.h!.control).toEqual({ kind: 'slider', min: 10, step: 1, max: 200 })
    expect(p.r!.control).toEqual({ kind: 'slider', min: 0.5, step: 0.1, max: 3 })
    expect(p.m!.control).toEqual({ kind: 'slider', min: 0, step: 1, max: 50 })
  })

  it('builds a stepped number input from a bare number', () => {
    expect(p.t!.control).toEqual({ kind: 'number', step: 0.5 })
  })

  it('builds dropdowns with string or number values and optional labels', () => {
    expect(p.shape!.control).toEqual({
      kind: 'dropdown',
      options: [{ value: 'round', label: 'round' }, { value: 'square', label: 'square' }],
    })
    expect(p.size_name!.control).toEqual({
      kind: 'dropdown',
      options: [{ value: 'S', label: 'Small' }, { value: 'M', label: 'Medium' }],
    })
    expect(p.teeth!.control).toEqual({ kind: 'dropdown', options: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }] })
    expect(p.pa!.control).toEqual({
      kind: 'dropdown',
      options: [{ value: 14.5, label: '14.5' }, { value: 20, label: '20' }, { value: 25, label: '25' }],
    })
  })

  it('builds a toggle, a text input and a vector input from the value type', () => {
    expect(p.holes).toMatchObject({ defaultValue: true, control: { kind: 'toggle' } })
    expect(p.label).toMatchObject({ defaultValue: 'ABC', control: { kind: 'text' } })
    expect(p.size).toMatchObject({ defaultValue: [20, 30, 5], control: { kind: 'vector', length: 3 } })
  })

  it('gives an un-annotated number a plain number input and marks it un-annotated', () => {
    expect(p.n).toMatchObject({ defaultValue: 7, control: { kind: 'number' }, annotated: false })
  })
})

describe('groups, hidden parameters and descriptions', () => {
  const code = [
    '// Outer width',
    'width = 20; // [5:1:100]',
    '/* [Lid] */',
    'lid = 2; // [1:5]',
    '',
    '// not attached: blank line below',
    '',
    'gap = 0.2; // 0.05',
    '/* [Hidden] */',
    'secret = 1;',
    '/* [Extras] */',
    'a = 1; // [0:10]',
    'b = 2;',
  ].join('\n')

  it('assigns groups in order and hides everything after [Hidden] until the next group', () => {
    expect(parseCustomizer(code).map((p) => [p.name, p.group])).toEqual([
      ['width', ''], ['lid', 'Lid'], ['gap', 'Lid'], ['a', 'Extras'], ['b', 'Extras'],
    ])
  })

  it('takes the description from a comment alone on the line directly above', () => {
    const p = byName(code)
    expect(p.width!.description).toBe('Outer width')
    expect(p.gap!.description).toBe('')
  })

  it("does not take the previous line's trailing annotation as a description", () => {
    expect(byName(code).b!.description).toBe('')
  })
})

describe('what is not a Customizer parameter', () => {
  it('stops at the first module or function definition', () => {
    const code = 'a = 1;\nmodule m() { inner = 3; cube(inner); }\nb = 2;\nfunction f() = 1;\nc = 3;'
    expect(parseCustomizer(code).map((p) => p.name)).toEqual(['a'])
    expect(parseCustomizer('function f(x) = x;\nz = 1;')).toEqual([])
  })

  it('ignores assignments that are not at top level', () => {
    const code = 'if (true) { x = 1; }\nfor (i = [0:2]) cube(i);\ntranslate([1, 0, 0]) { y = 2; }\nz = 3;'
    expect(parseCustomizer(code).map((p) => p.name)).toEqual(['z'])
  })

  it('skips expressions, references, ranges, nested vectors and special variables', () => {
    const code = [
      'a = 10 * 2;', 'b = a;', 'c = PI;', 'd = -a;', 'e = [0:10];', 'f = [[1, 2], [3, 4]];',
      'g = [1, [2]];', 'h = [];', 'i = [1, 2, 3, 4, 5];', '$fn = 64;', 'j = 5;',
    ].join('\n')
    expect(parseCustomizer(code).map((p) => p.name)).toEqual(['j'])
  })

  it('finds no parameters inside comments or strings that look like assignments', () => {
    const code = [
      '/* depth = 3; // [1:10] */',
      'label = "w = 5; // [1:10]"; // the label',
      '// width = 9;',
      'url = "http://x/y";',
    ].join('\n')
    const params = parseCustomizer(code)
    expect(params.map((p) => p.name)).toEqual(['label', 'url'])
    expect(params[0]).toMatchObject({ defaultValue: 'w = 5; // [1:10]', control: { kind: 'text' }, annotated: false })
    expect(params[1]!.defaultValue).toBe('http://x/y')
  })

  it('finds parameters after include and use lines', () => {
    expect(parseCustomizer('include <BOSL2/std.scad>\nuse <MCAD/boxes.scad>\nw = 2; // [1:5]').map((p) => p.name)).toEqual(['w'])
  })

  it('does not throw on malformed input', () => {
    for (const code of ['w = ;', 'w = 3', 'w = (;', '= 4;', 'w = "open', '/* [Lid', ')))]]]};;;', '']) {
      expect(() => parseCustomizer(code)).not.toThrow()
    }
    expect(parseCustomizer('w = ;\nh = 3')).toEqual([])
  })
})

describe('literal parsing', () => {
  it('reads negative numbers, negative vector items and string escapes', () => {
    const p = byName(String.raw`x = -5; // [-10:1:10]
v = [-1, 2.5, -3e1];
s = "say \"hi\"\n";`)
    expect(p.x).toMatchObject({ defaultValue: -5, control: { kind: 'slider', min: -10, step: 1, max: 10 } })
    expect(p.v!.defaultValue).toEqual([-1, 2.5, -30])
    expect(p.s!.defaultValue).toBe('say "hi"\n')
  })

  it('lets a later literal assignment win and a later expression remove the parameter', () => {
    expect(byName('w = 1; // [0:5]\nw = 3; // [0:10]').w).toMatchObject({ defaultValue: 3, line: 2 })
    expect(byName('w = 1;\nw = w + 1;').w).toBeUndefined()
  })

  it('falls back to a plain number input when an annotation is not usable', () => {
    for (const note of ['[10:1:5]', '[0:0:10]', '[[1, 2]]', '[]', 'the width', '[a:b:c:d:e]']) {
      expect(byName(`w = 4; // ${note}`).w).toMatchObject({ control: { kind: 'number' }, annotated: false })
    }
  })

  it('reads a size source after the annotation and keeps the control', () => {
    const code = ['rod_d = 25; // [15:0.5:40] from description', 'wall = 3; // [1.2:0.2:6] guessed', 'plate_w = 22; // [14:1:40] from photo', 'n = 4; // 1 guessed', 'plain = 2; // [1:9]'].join('\n')
    const params = parseCustomizer(code)
    expect(params.map((p) => p.source)).toEqual(['description', 'guess', 'photo', 'guess', null])
    expect(params[0]!.control).toEqual({ kind: 'slider', min: 15, step: 0.5, max: 40 })
    expect(params[3]!.control).toEqual({ kind: 'number', step: 1 })
    expect(params[3]!.annotated).toBe(true)
  })

  it('ignores trailing words that are not a source', () => {
    const [p] = parseCustomizer('w = 5; // [1:10] mm')
    expect(p!.source).toBeNull()
    expect(p!.control).toEqual({ kind: 'slider', min: 1, step: 1, max: 10 })
  })

  it('cuts a bracket annotation at its first closing bracket, keeping the fallback for nested ones', () => {
    expect(parseCustomizer('w = 5; // [1:10]mm')[0]).toMatchObject({ control: { kind: 'slider', min: 1, step: 1, max: 10 }, source: null })
    expect(parseCustomizer('w = 5; // [[1, 2]] mm')[0]).toMatchObject({ control: { kind: 'number' }, annotated: false, source: null })
  })

  it('matches a source only as a whole word', () => {
    expect(parseCustomizer('w = 5; // [1:10] unguessed')[0]!.source).toBeNull()
    expect(parseCustomizer('x = 5; // overguessed')[0]!.source).toBeNull()
  })

  it('reads a source on an un-annotated number too', () => {
    const [p] = parseCustomizer('depth = 24; // guessed')
    expect(p!.source).toBe('guess')
    expect(p!.control).toEqual({ kind: 'number' })
    expect(p!.annotated).toBe(false)
  })

  it('does not use a slider annotation on a string, nor a step on a string', () => {
    expect(byName('s = "a"; // 8').s).toMatchObject({ control: { kind: 'text' }, annotated: false })
  })
})

describe('bakeParams', () => {
  const code = '/* [Size] */\nw = 40; // [10:1:200]\nlabel = "A";\nsize = [1, 2];\non = true;\n/* [Hidden] */\nk = 9;\n'

  it('rewrites only the default values, keeping comments and layout', () => {
    expect(bakeParams(code, { w: -12.5, label: 'say "hi"', size: [3, 4], on: false, k: 1, missing: 2 })).toBe(
      '/* [Size] */\nw = -12.5; // [10:1:200]\nlabel = "say \\"hi\\"";\nsize = [3, 4];\non = false;\n/* [Hidden] */\nk = 9;\n',
    )
  })

  it('ignores values whose type does not match the default', () => {
    expect(bakeParams(code, { w: 'x', size: [1, 2, 3] })).toBe(code)
  })

  it('round-trips: parsing the baked code gives the baked values as defaults', () => {
    const baked = bakeParams(code, { w: 77, size: [5, 6] })
    expect(effectiveValues(baked, {})).toEqual({ w: 77, label: 'A', size: [5, 6], on: true })
  })
})

describe('paramOverrides and effectiveValues', () => {
  const code = 'w = 40; // [10:1:200]\nlabel = "A";\nsize = [1, 2];\n/* [Hidden] */\nk = 9;'

  it('keeps only known, visible parameters whose value has the right type and differs from the default', () => {
    expect(paramOverrides(code, { w: 40, label: 'B', size: [1, 2, 3], k: 1, gone: 3 })).toEqual({ label: 'B' })
    expect(paramOverrides(code, { w: '40' })).toEqual({})
  })

  it('merges valid overrides over the defaults', () => {
    expect(effectiveValues(code, { w: 50, size: ['x'] as unknown as number[] })).toEqual({ w: 50, label: 'A', size: [1, 2] })
  })
})
