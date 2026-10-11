import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export const openscadHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)' },
  { tag: tags.standard(tags.variableName), color: 'var(--syn-builtin)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.comment, color: 'var(--syn-comment)' },
])

const chrome = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--inset)', color: 'var(--ink)', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--ink)', padding: 'var(--space-2) 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'var(--inset)', color: 'var(--syn-comment)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--space-2) 0 var(--space-3)', minWidth: '44px' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--line-strong)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--error)' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--panel-raised)',
    color: 'var(--ink)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-pop)',
    fontFamily: 'var(--font-sans)',
  },
  // diagnosticsExtension (Step 6)
  '.cm-diag-line-error': { backgroundColor: 'var(--error-soft)' },
  '.cm-diag-line-warning': { backgroundColor: 'var(--warn-soft)' },
  '.cm-gutterElement.cm-diag-gutter-error': { color: 'var(--error)' },
  '.cm-gutterElement.cm-diag-gutter-warning': { color: 'var(--warn)' },
  '.cm-diag-callout': {
    margin: 'var(--space-1) var(--space-3) var(--space-1) 0',
    fontFamily: 'var(--font-sans)',
    fontSize: '14px',
    lineHeight: '20px',
    whiteSpace: 'normal',
  },
})

export const tokenTheme: Extension = [chrome, syntaxHighlighting(openscadHighlight)]
