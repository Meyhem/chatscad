export const LIBRARY_NAMES = ['BOSL2', 'MCAD'] as const
export type LibraryName = (typeof LIBRARY_NAMES)[number]

export const isLibraryName = (name: string): name is LibraryName => (LIBRARY_NAMES as readonly string[]).includes(name)

/** Shown in Settings › Libraries; `version` must match the pinned archive in scripts/fetch-libraries.ts. */
export const LIBRARY_INFO: Record<LibraryName, { version: string; license: string; usage: string }> = {
  BOSL2: { version: 'v2.0.766', license: 'BSD-2-Clause', usage: 'include <BOSL2/std.scad>' },
  MCAD: { version: 'bd0a7ba', license: 'LGPL-2.1', usage: 'use <MCAD/boxes.scad>' },
}

/** public/libraries/<name>.json, produced by scripts/fetch-libraries.ts. */
export interface LibraryBundle {
  name: LibraryName
  version: string
  /** The pinned archive URL the bundle was built from. */
  source: string
  /** Path relative to the library root → file text. */
  files: Record<string, string>
}

/** Enabled libraries live at /libraries/<name>/ in the OpenSCAD FS; OPENSCADPATH points here. */
export const LIBRARY_ROOT = '/libraries'

export const libraryUrl = (base: string, name: LibraryName) => `${base}libraries/${name}.json`

export function safeLibraryPath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

export interface LibraryFs {
  mkdirTree(path: string): void
  writeFile(path: string, data: string): void
}

export function writeLibraries(fs: LibraryFs, bundles: LibraryBundle[]): void {
  const made = new Set<string>()
  for (const bundle of bundles) {
    for (const [path, text] of Object.entries(bundle.files)) {
      if (!safeLibraryPath(path)) continue
      const full = `${LIBRARY_ROOT}/${bundle.name}/${path}`
      const dir = full.slice(0, full.lastIndexOf('/'))
      if (!made.has(dir)) {
        fs.mkdirTree(dir)
        made.add(dir)
      }
      fs.writeFile(full, text)
    }
  }
}
