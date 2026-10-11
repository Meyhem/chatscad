import { isLibraryName, LIBRARY_INFO, LIBRARY_NAMES, libraryUrl, safeLibraryPath, writeLibraries, type LibraryBundle } from './libraries'

it('knows BOSL2 and MCAD and nothing else', () => {
  expect(LIBRARY_NAMES).toEqual(['BOSL2', 'MCAD'])
  expect(isLibraryName('BOSL2')).toBe(true)
  expect(isLibraryName('../etc')).toBe(false)
  expect(LIBRARY_INFO.BOSL2).toMatchObject({ version: 'v2.0.766', license: 'BSD-2-Clause', usage: 'include <BOSL2/std.scad>' })
  expect(LIBRARY_INFO.MCAD).toMatchObject({ license: 'LGPL-2.1', usage: 'use <MCAD/boxes.scad>' })
})

it('builds bundle URLs under the base path', () => {
  expect(libraryUrl('/chatscad/', 'BOSL2')).toBe('/chatscad/libraries/BOSL2.json')
})

it('accepts only relative paths without empty or parent segments', () => {
  expect(safeLibraryPath('std.scad')).toBe(true)
  expect(safeLibraryPath('bitmap/bitmap.scad')).toBe(true)
  for (const bad of ['/etc/passwd', '../x.scad', 'a/../../x', 'a//b.scad', '']) expect(safeLibraryPath(bad)).toBe(false)
})

it('writes each bundle under /libraries/<name>/, creating each directory once and skipping unsafe paths', () => {
  const dirs: string[] = []
  const files = new Map<string, string>()
  const bundle: LibraryBundle = {
    name: 'MCAD',
    version: 'x',
    source: 'https://example.test/mcad.zip',
    files: { 'boxes.scad': 'module b() {}', 'bitmap/bitmap.scad': '//', 'bitmap/x.scad': '//', '../evil.scad': 'x' },
  }
  writeLibraries({ mkdirTree: (p) => void dirs.push(p), writeFile: (p, d) => void files.set(p, d) }, [bundle])
  expect(dirs).toEqual(['/libraries/MCAD', '/libraries/MCAD/bitmap'])
  expect([...files.keys()]).toEqual(['/libraries/MCAD/boxes.scad', '/libraries/MCAD/bitmap/bitmap.scad', '/libraries/MCAD/bitmap/x.scad'])
})
