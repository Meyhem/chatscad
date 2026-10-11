import { highlightingFor } from '@codemirror/language'
import { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { fireEvent, render, screen } from '@testing-library/react'
import { CodeEditor, toCmDiagnostics } from './CodeEditor'

function viewOf(container: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
  if (!view) throw new Error('no EditorView')
  return view
}

it('shows the initial value', () => {
  render(<CodeEditor value="cube(10);" onChange={() => {}} diagnostics={[]} />)
  expect(screen.getByTestId('code-editor')).toHaveTextContent('cube(10);')
})

it('calls onChange with the full document when the user edits', () => {
  const onChange = vi.fn()
  const { container } = render(<CodeEditor value="cube(10);" onChange={onChange} diagnostics={[]} />)
  const view = viewOf(container)
  view.dispatch({ changes: { from: view.state.doc.length, insert: '\nsphere(5);' } })
  expect(onChange).toHaveBeenLastCalledWith('cube(10);\nsphere(5);')
})

it('replaces the document when the value prop changes externally', () => {
  const { container, rerender } = render(<CodeEditor value="a" onChange={() => {}} diagnostics={[]} />)
  rerender(<CodeEditor value="b" onChange={() => {}} diagnostics={[]} />)
  expect(viewOf(container).state.doc.toString()).toBe('b')
})

it('colours keywords with the syn-keyword token class', () => {
  const { container } = render(<CodeEditor value="module m() {}" onChange={() => {}} diagnostics={[]} />)
  const cls = highlightingFor(viewOf(container).state, [tags.keyword])
  expect(cls).toBeTruthy()
  const keyword = container.querySelector(`.${cls!.split(' ').join('.')}`)
  expect(keyword).toHaveTextContent('module')
})

it('marks the error line, colours its gutter number, and shows the callout as text only', () => {
  const evil = 'syntax error <img src=x onerror=alert(1)>'
  const { container } = render(
    <CodeEditor value={'cube(1);\nsphere(\nx'} onChange={() => {}} diagnostics={[{ line: 2, severity: 'error', message: evil }]} />,
  )
  expect(container.querySelector('.cm-diag-line-error')).toHaveTextContent('sphere(')
  expect(container.querySelector('.cm-gutterElement.cm-diag-gutter-error')).toHaveTextContent('2')
  const callout = container.querySelector('.cm-diag-callout')
  expect(callout).toHaveClass('pc-callout', 'is-error')
  expect(callout).toHaveTextContent(`Line 2: ${evil}`)
  expect(callout?.querySelector('img')).toBeNull()
})

it('reveals a requested line by selecting its start', () => {
  const { container, rerender } = render(<CodeEditor value={'a\nb\nc'} onChange={() => {}} diagnostics={[]} reveal={null} />)
  rerender(<CodeEditor value={'a\nb\nc'} onChange={() => {}} diagnostics={[]} reveal={{ line: 3, id: 1 }} />)
  expect(viewOf(container).state.selection.main.head).toBe(4)
})

describe('toCmDiagnostics', () => {
  const doc = Text.of(['cube(1);', 'sphere(', 'x'])
  it('spans the whole reported line with the headline as the message', () => {
    expect(toCmDiagnostics(doc, [{ line: 2, severity: 'error', message: 'syntax error' }])).toEqual([
      { from: 9, to: 16, severity: 'error', message: 'Line 2: syntax error' },
    ])
  })
  it('clamps lines outside the document instead of throwing', () => {
    const [d] = toCmDiagnostics(doc, [{ line: 99, severity: 'warning', message: 'w' }])
    expect(d).toMatchObject({ from: 17, to: 18 })
  })
})

it('does not report a value it was given as an edit', () => {
  const onChange = vi.fn()
  const { rerender } = render(<CodeEditor value="a" onChange={onChange} diagnostics={[]} />)
  rerender(<CodeEditor value="b" onChange={onChange} diagnostics={[]} />)
  expect(onChange).not.toHaveBeenCalled()
})

it('calls onBlur when the editor loses focus', () => {
  const onBlur = vi.fn()
  const { container } = render(<CodeEditor value="a" onChange={() => {}} diagnostics={[]} onBlur={onBlur} />)
  fireEvent.blur(container.querySelector('.cm-content')!)
  expect(onBlur).toHaveBeenCalledTimes(1)
})

it('keeps a value it was given out of its own undo history, so undo never brings back another project or version', async () => {
  const { undo } = await import('@codemirror/commands')
  const { container, rerender } = render(<CodeEditor value="project A" onChange={() => {}} diagnostics={[]} />)
  rerender(<CodeEditor value="project B" onChange={() => {}} diagnostics={[]} />)
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  undo(view)
  expect(view.state.doc.toString()).toBe('project B')
})

it('inserts key-row text at the cursor and keeps focus in the editor', () => {
  const onChange = vi.fn()
  const { container, rerender } = render(<CodeEditor value="cube(1)" onChange={onChange} diagnostics={[]} />)
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  view.dispatch({ selection: { anchor: 7 } })
  rerender(<CodeEditor value="cube(1)" onChange={onChange} diagnostics={[]} insert={{ text: ';', id: 1 }} />)
  expect(onChange).toHaveBeenLastCalledWith('cube(1);')
  expect(document.activeElement).toBe(view.contentDOM)
  rerender(<CodeEditor value="cube(1)" onChange={onChange} diagnostics={[]} insert={{ text: ';', id: 1 }} />)
  expect(view.state.doc.toString()).toBe('cube(1);')
})

it('does not replay an earlier key-row insert when the editor mounts again', () => {
  const onChange = vi.fn()
  render(<CodeEditor value="cube(1)" onChange={onChange} diagnostics={[]} insert={{ text: ';', id: 7 }} />)
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByTestId('code-editor')).toHaveTextContent('cube(1)')
  expect(screen.getByTestId('code-editor')).not.toHaveTextContent(';')
})
