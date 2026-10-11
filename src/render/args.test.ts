import { buildArgs, formatParamValue, INPUT_PATH, OUTPUT_PATH } from './args'

describe('buildArgs', () => {
  it('compiles main.scad to binary STL with the manifold backend', () => {
    expect(buildArgs()).toEqual([INPUT_PATH, '-o', OUTPUT_PATH, '--backend=manifold', '--export-format=binstl'])
  })

  it('adds one -D override per parameter', () => {
    const args = buildArgs({ w: 40, holes: true, label: 'A"B', size: [20, 30, 5] })
    expect(args.slice(5)).toEqual(['-D', 'w=40', '-D', 'holes=true', '-D', 'label="A\\"B"', '-D', 'size=[20,30,5]'])
  })

  it('rejects parameter names that are not OpenSCAD identifiers', () => {
    expect(() => buildArgs({ 'a=1;b': 2 })).toThrow('Invalid parameter name: a=1;b')
  })

  it('rejects non-finite numbers', () => {
    expect(() => buildArgs({ w: Number.NaN })).toThrow('must be finite')
    expect(() => buildArgs({ v: [1, Infinity] })).toThrow('must be finite')
  })
})

describe('formatParamValue', () => {
  it('formats each value type as an OpenSCAD literal', () => {
    expect(formatParamValue(0.5)).toBe('0.5')
    expect(formatParamValue(false)).toBe('false')
    expect(formatParamValue('round')).toBe('"round"')
    expect(formatParamValue([1, 2])).toBe('[1,2]')
  })
})
