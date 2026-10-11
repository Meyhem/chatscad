import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { EditorState, type Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import type { Diagnostic } from '../render/types'
import type { RevealRequest } from '../state/store'
import { calloutHeadline, diagnosticsByLine, diagnosticsExtension, setAppDiagnostics } from './diagnosticsExtension'
import { openscad } from './openscadLanguage'
import { tokenTheme } from './theme'

export function toCmDiagnostics(doc: Text, diagnostics: Diagnostic[]): CmDiagnostic[] {
  return diagnosticsByLine(doc, diagnostics).map((d) => {
    const line = doc.line(d.line)
    return { from: line.from, to: line.to, severity: d.severity, message: calloutHeadline(d) }
  })
}

interface Props {
  value: string
  onChange(code: string): void
  diagnostics: Diagnostic[]
  reveal?: RevealRequest | null
}

export function CodeEditor({ value, onChange, diagnostics, reveal = null }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
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
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
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

  return <div ref={hostRef} className="h-full min-h-0 bg-inset" data-testid="code-editor" />
}
