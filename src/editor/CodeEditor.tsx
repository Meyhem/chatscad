import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { Annotation, EditorState, Transaction, type Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import type { Diagnostic } from '../render/types'
import type { InsertRequest, RevealRequest } from '../state/store'
import { calloutHeadline, diagnosticsByLine, diagnosticsExtension, setAppDiagnostics } from './diagnosticsExtension'
import { openscad } from './openscadLanguage'
import { tokenTheme } from './theme'

export function toCmDiagnostics(doc: Text, diagnostics: Diagnostic[]): CmDiagnostic[] {
  return diagnosticsByLine(doc, diagnostics).map((d) => {
    const line = doc.line(d.line)
    return { from: line.from, to: line.to, severity: d.severity, message: calloutHeadline(d) }
  })
}

/** Marks the transaction that mirrors a new `value` prop, so it is not reported back as an edit. */
const external = Annotation.define<boolean>()

interface Props {
  value: string
  onChange(code: string): void
  diagnostics: Diagnostic[]
  reveal?: RevealRequest | null
  onBlur?(): void
  /** From the phone key row; each new id inserts once at the cursor. */
  insert?: InsertRequest | null
}

export function CodeEditor({ value, onChange, diagnostics, reveal = null, onBlur, insert = null }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          openscad(),
          tokenTheme,
          diagnosticsExtension,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) onChangeRef.current(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            blur: () => {
              onBlurRef.current?.()
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // The initial value is applied once; later changes go through the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== value) {
      // Kept out of the undo history: undo must never bring back another project's or version's code.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: [external.of(true), Transaction.addToHistory.of(false)],
      })
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // setDiagnostics() returns a TransactionSpec with its own lint effect; keep it and add ours.
    const spec = setDiagnostics(view.state, toCmDiagnostics(view.state.doc, diagnostics))
    const lintEffects = Array.isArray(spec.effects) ? spec.effects : spec.effects ? [spec.effects] : []
    view.dispatch({ ...spec, effects: [...lintEffects, setAppDiagnostics.of(diagnostics)] })
  }, [diagnostics])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !reveal) return
    const line = view.state.doc.line(Math.min(Math.max(reveal.line, 1), view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
  }, [reveal])

  // Keyed on the id, so re-rendering with an equal request never inserts twice; a request that was already
  // there when the editor mounted (the phone tabs remount it) was consumed by an earlier editor.
  const insertId = insert?.id
  const consumedInsert = useRef(insertId)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !insert || insert.id === consumedInsert.current) return
    consumedInsert.current = insert.id
    view.dispatch({ ...view.state.replaceSelection(insert.text), scrollIntoView: true, userEvent: 'input.type' })
    view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertId])

  return <div ref={hostRef} className="h-full min-h-0 bg-inset" data-testid="code-editor" />
}
