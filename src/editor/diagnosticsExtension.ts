import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutterLineClass, WidgetType } from '@codemirror/view'
import type { Diagnostic } from '../render/types'

export const setAppDiagnostics = StateEffect.define<readonly Diagnostic[]>()

/** One diagnostic per line (errors beat warnings), clamped into the document, sorted by line. */
export function diagnosticsByLine(doc: Text, diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const byLine = new Map<number, Diagnostic>()
  for (const d of diagnostics) {
    const line = Math.min(Math.max(d.line, 1), doc.lines)
    const existing = byLine.get(line)
    if (!existing || (existing.severity === 'warning' && d.severity === 'error')) byLine.set(line, { ...d, line })
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

export function calloutHeadline(d: Diagnostic): string {
  return `Line ${d.line}: ${d.message}`
}

class CalloutWidget extends WidgetType {
  constructor(readonly diagnostic: Diagnostic) {
    super()
  }

  eq(other: CalloutWidget): boolean {
    const a = this.diagnostic
    const b = other.diagnostic
    return a.line === b.line && a.severity === b.severity && a.message === b.message
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = `pc-callout cm-diag-callout is-${this.diagnostic.severity === 'error' ? 'error' : 'warn'}`
    el.setAttribute('role', 'note')
    const body = document.createElement('div')
    body.className = 'pc-callout-body'
    const headline = document.createElement('strong')
    headline.textContent = calloutHeadline(this.diagnostic) // text only: the message is model output
    body.append(headline)
    el.append(body)
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}

class ToneMarker extends GutterMarker {
  constructor(readonly elementClass: string) {
    super()
  }
}

const diagnosticsField = StateField.define<readonly Diagnostic[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAppDiagnostics)) return e.value
    return value
  },
})

const lineDecorations = EditorView.decorations.compute(['doc', diagnosticsField], (state) => {
  const builder = new RangeSetBuilder<Decoration>()
  for (const d of diagnosticsByLine(state.doc, state.field(diagnosticsField))) {
    const line = state.doc.line(d.line)
    builder.add(line.from, line.from, Decoration.line({ class: `cm-diag-line cm-diag-line-${d.severity}` }))
    builder.add(line.to, line.to, Decoration.widget({ widget: new CalloutWidget(d), block: true, side: 1 }))
  }
  return builder.finish()
})

const gutterTones = gutterLineClass.compute(['doc', diagnosticsField], (state) => {
  const builder = new RangeSetBuilder<GutterMarker>()
  for (const d of diagnosticsByLine(state.doc, state.field(diagnosticsField))) {
    const line = state.doc.line(d.line)
    builder.add(line.from, line.from, new ToneMarker(`cm-diag-gutter-${d.severity}`))
  }
  return builder.finish()
})

export const diagnosticsExtension: Extension = [diagnosticsField, lineDecorations, gutterTones]
