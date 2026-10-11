import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { LineRange } from '../scad/statements'

export const setPickLines = StateEffect.define<LineRange | null>()

const pickField = StateField.define<LineRange | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPickLines)) return e.value
    return value
  },
})

const pickDecorations = EditorView.decorations.compute(['doc', pickField], (state) => {
  const builder = new RangeSetBuilder<Decoration>()
  const range = state.field(pickField)
  if (range) {
    const first = Math.max(1, Math.min(range.startLine, state.doc.lines))
    const last = Math.max(first, Math.min(range.endLine, state.doc.lines))
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-pick-line' }))
    }
  }
  return builder.finish()
})

/** The picked part's lines, styled like the Refine screen's `.cl.is-pick`. */
export const pickExtension: Extension = [pickField, pickDecorations]
