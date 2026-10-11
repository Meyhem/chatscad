import { listTaggableStatements } from './statements'
import { decodeTag, encodeTag, MAX_TAG, tagCode, tagColor } from './tagging'

describe('encodeTag', () => {
  it('packs tag ids into the three colour bytes, red first', () => {
    expect(encodeTag(1)).toEqual([0, 0, 1])
    expect(encodeTag(70_000)).toEqual([1, 17, 112])
    expect(encodeTag(MAX_TAG)).toEqual([255, 255, 254])
  })

  it('rejects ids that do not fit or are not integers', () => {
    expect(() => encodeTag(0)).toThrow(RangeError)
    expect(() => encodeTag(MAX_TAG + 1)).toThrow(RangeError)
    expect(() => encodeTag(1.5)).toThrow(RangeError)
  })
})

describe('decodeTag', () => {
  it('reverses encodeTag', () => {
    expect(decodeTag(1, 17, 112, 70_000)).toBe(70_000)
  })

  it('tolerates float rounding in each channel', () => {
    expect(decodeTag(0.9996, 16.9996, 112.4, 70_000)).toBe(70_000)
    expect(decodeTag(-0.2, 0, 255.3, 255)).toBe(255)
  })

  it('returns 0 for colours that are not one of the known tags', () => {
    expect(decodeTag(249, 215, 44, 3)).toBe(0) // OpenSCAD's default colour
    expect(decodeTag(0, 0, 0, 3)).toBe(0)
    expect(decodeTag(0, 0, 4, 3)).toBe(0)
  })
})

describe('tagCode', () => {
  it('formats a colour OpenSCAD evaluates exactly', () => {
    expect(tagColor(258)).toBe('color([0 / 255, 1 / 255, 2 / 255])')
  })

  it('wraps each statement on its own line, before any modifier, without moving lines', () => {
    const code = 'w = 3;\ncube(w);\n#sphere(2);\n'
    const tagged = tagCode(code, listTaggableStatements(code))
    expect(tagged).toBe('w = 3;\ncolor([0 / 255, 0 / 255, 1 / 255]) cube(w);\ncolor([0 / 255, 0 / 255, 2 / 255]) #sphere(2);\n')
    expect(tagged.split('\n')).toHaveLength(code.split('\n').length)
  })

  it('wraps the children of a top-level boolean, not the boolean', () => {
    const code = 'difference() {\n  cube(10);\n  cylinder(h = 12, r = 2);\n}\n'
    expect(tagCode(code, listTaggableStatements(code))).toBe(
      'difference() {\n  color([0 / 255, 0 / 255, 1 / 255]) cube(10);\n  color([0 / 255, 0 / 255, 2 / 255]) cylinder(h = 12, r = 2);\n}\n',
    )
  })

  it('returns the code unchanged when nothing is taggable', () => {
    expect(tagCode('w = 1;\n', [])).toBe('w = 1;\n')
  })
})
