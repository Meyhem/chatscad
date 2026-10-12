export const LIBRARY_NAMES = ['BOSL2', 'MCAD'] as const
export type LibraryName = (typeof LIBRARY_NAMES)[number]

export const isLibraryName = (name: string): name is LibraryName => (LIBRARY_NAMES as readonly string[]).includes(name)

export interface LibraryInfo {
  /** Must match the pinned archive in scripts/fetch-libraries.ts. */
  version: string
  license: string
  usage: string
  title: string
  summary: string
  contents: Array<{ name: string; detail: string }>
  goodFor: string
  tradeoff: string
}

/** Shown in the new project dialog and Settings › Libraries. */
export const LIBRARY_INFO: Record<LibraryName, LibraryInfo> = {
  BOSL2: {
    version: 'v2.0.766',
    license: 'BSD-2-Clause',
    usage: 'include <BOSL2/std.scad>',
    title: 'Belfry OpenSCAD Library',
    summary: 'Threads, gears, rounded edges and parts that attach to each other. Best for mechanical parts.',
    contents: [
      { name: 'Rounded and chamfered shapes', detail: 'boxes, cylinders, tubes' },
      { name: 'Threads', detail: 'ISO metric, pipe and trapezoidal' },
      { name: 'Screws and nuts', detail: 'with matching holes' },
      { name: 'Gears', detail: 'spur, bevel, worm, racks' },
      { name: 'Attachments', detail: 'place a part on a face of another' },
      { name: 'Hinges and snap fits', detail: 'print-in-place joints' },
      { name: 'Sweeps and paths', detail: 'bent tubes, handles' },
      { name: 'Text and patterns', detail: 'knurling, grids, arrays' },
    ],
    goodFor: 'threaded lids, enclosures with fillets, gearboxes.',
    tradeoff: 'renders take longer, and the .scad file needs BOSL2 to open in desktop OpenSCAD.',
  },
  MCAD: {
    version: 'bd0a7ba',
    license: 'LGPL-2.1',
    usage: 'use <MCAD/boxes.scad>',
    title: 'OpenSCAD MCAD',
    summary: 'The classic library that used to ship with OpenSCAD. Simple gears, bolts and motor outlines.',
    contents: [
      { name: 'Rounded boxes', detail: 'roundedCube' },
      { name: 'Involute gears', detail: 'basic spur gears' },
      { name: 'Nuts and bolts', detail: 'metric hex hardware' },
      { name: 'Motor outlines', detail: 'NEMA steppers, servos' },
      { name: 'Bearings', detail: 'common ball bearing sizes' },
      { name: 'Polygons', detail: 'regular shapes, triangles' },
    ],
    goodFor: 'motor mounts and older models that already use MCAD.',
    tradeoff: 'smaller and dated; BOSL2 covers most of it better.',
  },
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
