// @vitest-environment node
import { pickLatestWasmZip } from './fetch-openscad'

const listing = `
<a href="OpenSCAD-2025.01.19.ai22731-WebAssembly-web.zip">x</a>
<a href="OpenSCAD-2025.03.02.ai23104-WebAssembly-web.zip">x</a>
<a href="OpenSCAD-2025.03.02.ai23104-WebAssembly-node.zip">x</a>
<a href="OpenSCAD-2024.12.30.ai22600-x86_64.AppImage">x</a>
<a href="OpenSCAD-2025.03.02.ai23099-WebAssembly-web.zip">x</a>`

it('picks the newest web WebAssembly zip', () => {
  expect(pickLatestWasmZip(listing)).toBe('OpenSCAD-2025.03.02.ai23104-WebAssembly-web.zip')
})

it('returns null when no web zip is listed', () => {
  expect(pickLatestWasmZip('<a href="OpenSCAD-2025.01.01-x86_64.AppImage">')).toBeNull()
})

import { createHash } from 'node:crypto'
import { PINNED, resolveSource, verifySha256 } from './fetch-openscad'

describe('resolveSource', () => {
  it('uses the pinned snapshot and hash by default', () => {
    expect(resolveSource({})).toEqual(PINNED)
    expect(PINNED.url).toMatch(/^https:\/\/files\.openscad\.org\/snapshots\/OpenSCAD-.*-WebAssembly-web\.zip$/)
    expect(PINNED.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts an override only together with its hash', () => {
    expect(resolveSource({ OPENSCAD_WASM_URL: 'https://x/a.zip', OPENSCAD_WASM_SHA256: 'AB'.repeat(32) })).toEqual({
      url: 'https://x/a.zip',
      sha256: 'ab'.repeat(32),
    })
    expect(() => resolveSource({ OPENSCAD_WASM_URL: 'https://x/a.zip' })).toThrow('OPENSCAD_WASM_SHA256')
  })
})

describe('verifySha256', () => {
  const bytes = new TextEncoder().encode('openscad')
  const good = createHash('sha256').update(bytes).digest('hex')

  it('accepts bytes with the expected hash', () => {
    expect(() => verifySha256(bytes, good)).not.toThrow()
  })

  it('rejects bytes whose hash differs, naming both hashes', () => {
    expect(() => verifySha256(bytes, '0'.repeat(64))).toThrow(new RegExp(`expected 0{64}, got ${good}`))
  })
})
