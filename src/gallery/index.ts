import type { GlyphShape } from '../ui/Glyph'
import boxWithLid from './examples/box-with-lid.scad?raw'
import cableClip from './examples/cable-clip.scad?raw'
import enclosure from './examples/enclosure.scad?raw'
import knob from './examples/knob.scad?raw'
import lBracket from './examples/l-bracket.scad?raw'
import phoneStand from './examples/phone-stand.scad?raw'
import hinge from './examples/print-in-place-hinge.scad?raw'
import spurGear from './examples/spur-gear.scad?raw'

export type GalleryCategory = 'Storage' | 'Mounting' | 'Mechanical' | 'Desk'

export const CATEGORIES: GalleryCategory[] = ['Storage', 'Mounting', 'Mechanical', 'Desk']

export interface GalleryExample {
  id: string
  name: string
  tags: string[]
  category: GalleryCategory
  /** The iso line glyph from the Gallery screen (not a render). */
  glyph: GlyphShape[]
  code: string
}

const poly = (face: 'f-l' | 'f-r' | 'f-top', points: string): GlyphShape => ({ kind: 'polygon', face, points })
const hole = (cx: number, cy: number, rx: number, ry: number): GlyphShape => ({ kind: 'ellipse', face: 'f-hole', cx, cy, rx, ry })

/** To add an example: put a parametric .scad file in ./examples and an entry here; the tests render it in CI. */
export const EXAMPLES: GalleryExample[] = [
  {
    id: 'box-with-lid',
    name: 'Box with lid',
    tags: ['storage', 'snap-fit'],
    category: 'Storage',
    glyph: [poly('f-l', '14,36 50,54 50,82 14,64'), poly('f-r', '50,54 86,36 86,64 50,82'), poly('f-top', '50,18 86,36 50,54 14,36')],
    code: boxWithLid,
  },
  {
    id: 'enclosure',
    name: 'Enclosure',
    tags: ['electronics', 'screw bosses'],
    category: 'Storage',
    glyph: [
      poly('f-l', '8,46 50,66 50,78 8,58'),
      poly('f-r', '50,66 92,46 92,58 50,78'),
      poly('f-top', '50,26 92,46 50,66 8,46'),
      hole(36, 46, 8, 4),
      hole(64, 46, 8, 4),
    ],
    code: enclosure,
  },
  {
    id: 'l-bracket',
    name: 'L bracket',
    tags: ['mounting', 'M3', 'M4'],
    category: 'Mounting',
    glyph: [
      poly('f-l', '20,40 50,55 50,70 20,55'),
      poly('f-r', '50,55 80,40 80,55 50,70'),
      poly('f-top', '50,25 80,40 50,55 20,40'),
      poly('f-r', '56,30 74,21 74,6 56,15'),
    ],
    code: lBracket,
  },
  {
    id: 'knob',
    name: 'Knob',
    tags: ['D-shaft', 'knurled'],
    category: 'Mechanical',
    glyph: [poly('f-l', '26,30 50,42 50,88 26,76'), poly('f-r', '50,42 74,30 74,76 50,88'), poly('f-top', '50,18 74,30 50,42 26,30'), hole(50, 30, 8, 4)],
    code: knob,
  },
  {
    id: 'spur-gear',
    name: 'Spur gear',
    tags: ['mechanical', 'module 1'],
    category: 'Mechanical',
    glyph: [poly('f-l', '8,46 50,66 50,74 8,54'), poly('f-r', '50,66 92,46 92,54 50,74'), poly('f-top', '50,26 92,46 50,66 8,46'), hole(50, 46, 10, 5)],
    code: spurGear,
  },
  {
    id: 'print-in-place-hinge',
    name: 'Print-in-place hinge',
    tags: ['mechanical', 'no supports'],
    category: 'Mechanical',
    glyph: [
      poly('f-l', '14,46 50,64 50,72 14,54'),
      poly('f-r', '50,64 86,46 86,54 50,72'),
      poly('f-top', '50,28 86,46 50,64 14,46'),
      poly('f-top', '40,40 60,30 60,24 40,34'),
    ],
    code: hinge,
  },
  {
    id: 'cable-clip',
    name: 'Cable clip',
    tags: ['desk', 'adhesive'],
    category: 'Desk',
    glyph: [poly('f-l', '30,44 50,54 50,74 30,64'), poly('f-r', '50,54 70,44 70,64 50,74'), poly('f-top', '50,34 70,44 50,54 30,44'), hole(50, 44, 9, 4.5)],
    code: cableClip,
  },
  {
    id: 'phone-stand',
    name: 'Phone stand',
    tags: ['desk', 'angle'],
    category: 'Desk',
    glyph: [
      poly('f-l', '20,40 50,55 50,70 20,55'),
      poly('f-r', '50,55 80,40 80,55 50,70'),
      poly('f-top', '50,25 80,40 50,55 20,40'),
      poly('f-r', '44,34 62,25 62,4 44,13'),
    ],
    code: phoneStand,
  },
]
