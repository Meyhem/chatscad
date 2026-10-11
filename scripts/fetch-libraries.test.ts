// @vitest-environment node
import { createHash } from 'node:crypto'
import { unzipSync, zipSync } from 'fflate'
import { LIBRARY_INFO, LIBRARY_NAMES } from '../src/render/libraries'
import { bundleFromZip, LIBRARY_SOURCES, verifyDownload } from './fetch-libraries'

const enc = (s: string) => new TextEncoder().encode(s)

it('pins every library to a GitHub archive and a SHA-256, matching the version shown in the app', () => {
  for (const name of LIBRARY_NAMES) {
    const { url, sha256 } = LIBRARY_SOURCES[name]
    expect(url).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w-]+\/archive\/.+\.zip$/)
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
  }
  expect(LIBRARY_SOURCES.BOSL2.url).toContain(LIBRARY_INFO.BOSL2.version)
  expect(LIBRARY_SOURCES.MCAD.url).toContain(LIBRARY_INFO.MCAD.version)
})

it('keeps .scad and licence files, strips the archive root and skips tests, examples and docs', () => {
  const zip = zipSync({
    'BOSL2-2.0.766/std.scad': enc('include <shapes3d.scad>'),
    'BOSL2-2.0.766/shapes3d.scad': enc('module cuboid() {}'),
    'BOSL2-2.0.766/LICENSE': enc('BSD'),
    'BOSL2-2.0.766/README.md': enc('readme'),
    'BOSL2-2.0.766/tests/test_x.scad': enc('x'),
    'BOSL2-2.0.766/examples/demo.scad': enc('x'),
    'BOSL2-2.0.766/tutorials/a.scad': enc('x'),
    'BOSL2-2.0.766/scripts/a.scad': enc('x'),
  })
  const bundle = bundleFromZip('BOSL2', 'v2.0.766', 'https://x/b.zip', unzipSync(zip))
  expect(bundle).toEqual({
    name: 'BOSL2',
    version: 'v2.0.766',
    source: 'https://x/b.zip',
    files: { 'std.scad': 'include <shapes3d.scad>', 'shapes3d.scad': 'module cuboid() {}', LICENSE: 'BSD' },
  })
})

it('keeps nested library folders such as MCAD/bitmap and the LGPL text', () => {
  const entries = {
    'MCAD-bd0a/boxes.scad': enc('b'),
    'MCAD-bd0a/bitmap/bitmap.scad': enc('m'),
    'MCAD-bd0a/lgpl-2.1.txt': enc('lgpl'),
    'MCAD-bd0a/test_mcad.py': enc('py'),
  }
  expect(Object.keys(bundleFromZip('MCAD', 'bd0a7ba', 'u', entries).files).sort()).toEqual(['bitmap/bitmap.scad', 'boxes.scad', 'lgpl-2.1.txt'])
})

it('refuses an archive without .scad files', () => {
  expect(() => bundleFromZip('MCAD', 'x', 'u', { 'MCAD-x/README': enc('r') })).toThrow('MCAD: the archive has no .scad files')
})

it('verifies downloads by SHA-256 and names the library on mismatch', () => {
  const bytes = enc('zip')
  const good = createHash('sha256').update(bytes).digest('hex')
  expect(() => verifyDownload(bytes, good, 'BOSL2')).not.toThrow()
  expect(() => verifyDownload(bytes, '0'.repeat(64), 'BOSL2')).toThrow(`BOSL2 download failed verification: expected ${'0'.repeat(64)}, got ${good}`)
})
