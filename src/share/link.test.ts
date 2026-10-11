import { compressToEncodedURIComponent } from 'lz-string'
import {
  createShareLink,
  decodeShareHash,
  encodeShare,
  fileStem,
  parseSharePayload,
  shareLevel,
  type SharePayload,
} from './link'

const payload: SharePayload = {
  v: 1,
  name: 'Halter für 18650 · Ø 19 mm',
  code: '/* [Dimensions] */\nslots = 4; // [1:1:8]\ncube([slots * 21, 25, 22]); // — fits a drawer\n',
  params: { slots: 5, label: 'AA', lid: true, size: [20, 30, 5] },
}

const hashOf = (json: string) => `#s=${compressToEncodedURIComponent(json)}`

it('round-trips code, unicode and every kind of parameter value', () => {
  expect(decodeShareHash(`#s=${encodeShare(payload)}`)).toEqual({ ok: true, payload })
})

it('ignores hashes that are not share links', () => {
  expect(decodeShareHash('')).toBeNull()
  expect(decodeShareHash('#other')).toBeNull()
})

it('accepts a link an app has percent-encoded', () => {
  expect(decodeShareHash(`#s=${encodeURIComponent(encodeShare(payload))}`)).toEqual({ ok: true, payload })
})

it('builds the link on the current page URL, replacing any hash', () => {
  const link = createShareLink(payload, 'https://meyhem.github.io/chatscad/?x=1#old')
  expect(link.url).toBe(`https://meyhem.github.io/chatscad/?x=1#s=${encodeShare(payload)}`)
  expect(link.bytes).toBe(link.url!.length)
  expect(link.level).toBe('ok')
  expect(link.payload).toBe(payload)
})

it('warns over 8 KB and refuses over 16,000 characters of link text', () => {
  expect(shareLevel('x', 'u'.repeat(8_000))).toBe('ok')
  expect(shareLevel('x', 'u'.repeat(8_001))).toBe('long')
  expect(shareLevel('x'.repeat(16_001), 'u')).toBe('too-long')
})

it('cleans up the name, and defaults it', () => {
  const named = parseSharePayload({ v: 1, name: `  Box\n with   lid ${'x'.repeat(300)}`, code: 'cube(1);', params: {} })
  expect(named.ok && named.payload.name.startsWith('Box with lid x')).toBe(true)
  expect(named.ok && named.payload.name.length).toBe(120)
  expect(parseSharePayload({ v: 1, code: 'cube(1);' })).toEqual({
    ok: true,
    payload: { v: 1, name: 'Shared model', code: 'cube(1);', params: {} },
  })
})

describe('rejects, in plain words', () => {
  const bad = (value: unknown) => {
    const r = parseSharePayload(value)
    if (r.ok) throw new Error('expected a rejection')
    return r.error
  }

  it('links from a newer format or without a model', () => {
    expect(bad({ v: 2, name: 'x', code: 'cube(1);', params: {} })).toBe(
      'The link was made by a newer ChatSCAD (format 2). Reload the app to update it, then open the link again.',
    )
    expect(bad([1, 2])).toBe('The link does not contain a ChatSCAD model.')
    expect(bad({ v: 1, name: 'x', code: '   ' })).toBe('The link has no OpenSCAD code.')
    expect(bad({ v: 1, code: 'x'.repeat(200_001) })).toBe('The code in the link is longer than 200,000 characters.')
  })

  it('parameters that are not names with simple values', () => {
    expect(bad({ v: 1, code: 'c', params: [1] })).toBe('The parameter values in the link are not a list of names and values.')
    expect(bad({ v: 1, code: 'c', params: { 'w-1': 2 } })).toBe('The link sets a parameter with an invalid name: “w-1”.')
    expect(bad({ v: 1, code: 'c', params: { w: { x: 1 } } })).toBe(
      'The value of parameter w in the link is not a number, true/false, text or a list of numbers.',
    )
    expect(bad({ v: 1, code: 'c', params: { size: ['1', 2] } })).toContain('parameter size')
    expect(bad({ v: 1, code: 'c', params: { size: [] } })).toContain('parameter size')
    expect(bad({ v: 1, code: 'c', params: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}`, i])) })).toBe(
      'The link sets more than 200 parameters.',
    )
  })

  it('a __proto__ parameter, without polluting any prototype', () => {
    const r = decodeShareHash(hashOf('{"v":1,"name":"x","code":"cube(1);","params":{"__proto__":{"polluted":1}}}'))
    expect(r).toEqual({ ok: false, error: 'The link sets a parameter with an invalid name: “__proto__”.' })
    expect(({} as { polluted?: number }).polluted).toBeUndefined()
  })

  it('damaged, cut-off and oversized links', () => {
    const damaged = 'The link is damaged or cut off, so the model could not be read. Ask for the link again, or for the .json file.'
    expect(decodeShareHash('#s=')).toEqual({ ok: false, error: damaged })
    expect(decodeShareHash('#s=garbage!!')).toEqual({ ok: false, error: damaged })
    const full = encodeShare(payload)
    expect(decodeShareHash(`#s=${full.slice(0, Math.floor(full.length / 2))}`)).toEqual({ ok: false, error: damaged })
    expect(decodeShareHash(hashOf('not json'))).toEqual({ ok: false, error: damaged })
    expect(decodeShareHash(`#s=${'A'.repeat(16_001)}`)).toEqual({
      ok: false,
      error: 'The link is too long to open (over 16.0 KB). Ask for the .json file instead.',
    })
  })
})

it('makes a safe file name from the project name', () => {
  expect(fileStem('Halter für 18650 · Ø 19 mm')).toBe('halter-f-r-18650-19-mm')
  expect(fileStem('***')).toBe('model')
})
