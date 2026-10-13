import { Color } from 'three'
import { readToken } from '../theme/tokens'

/** Part colours label the top-level parts of a model in review frames and the viewer's Part colours mode. */
export const PART_COLOUR_COUNT = 7

const NAMES = ['orange', 'sky blue', 'green', 'yellow', 'blue', 'vermillion', 'pink'] as const

const slot = (tag: number) => (tag - 1) % PART_COLOUR_COUNT

/** The design token for a part tag; 0 (untagged) is `part-none`. Colours repeat after seven parts. */
export function partToken(tag: number): string {
  return tag > 0 ? `part-${slot(tag) + 1}` : 'part-none'
}

/** The colour in plain words, for the reviewer prompt's legend. */
export function partColourName(tag: number): string {
  return tag > 0 ? NAMES[slot(tag)] : 'grey'
}

export interface PartPalette {
  colours: string[]
  none: string
}

/** The palette from the design tokens on <html>. */
export function readPartPalette(): PartPalette {
  return {
    colours: Array.from({ length: PART_COLOUR_COUNT }, (_, i) => readToken(`part-${i + 1}`)),
    none: readToken('part-none'),
  }
}

/** Per-vertex colours for a triangle soup: every vertex of a triangle gets its part's colour (three.js working colour space). */
export function faceColourArray(faceTags: Uint32Array, colours: readonly string[], none: string): Float32Array {
  const resolved = colours.map((c) => new Color(c))
  const grey = new Color(none)
  const out = new Float32Array(faceTags.length * 9)
  for (let t = 0; t < faceTags.length; t++) {
    const tag = faceTags[t]
    const c = tag > 0 ? resolved[slot(tag)] : grey
    for (let v = 0; v < 3; v++) {
      const i = t * 9 + v * 3
      out[i] = c.r
      out[i + 1] = c.g
      out[i + 2] = c.b
    }
  }
  return out
}
