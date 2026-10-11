import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { pickExtension, setPickLines } from './pickExtension'

function viewWith(doc: string) {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new EditorView({ parent, state: EditorState.create({ doc, extensions: [pickExtension] }) })
}

const DOC = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'].join('\n')

it('marks exactly the picked lines', () => {
  const view = viewWith(DOC)
  view.dispatch({ effects: setPickLines.of({ startLine: 3, endLine: 5 }) })
  const marked = [...view.dom.querySelectorAll('.cm-pick-line')].map((el) => el.textContent)
  expect(marked).toEqual(['line 3', 'line 4', 'line 5'])
  view.destroy()
})

it('clears the marks', () => {
  const view = viewWith(DOC)
  view.dispatch({ effects: setPickLines.of({ startLine: 2, endLine: 2 }) })
  view.dispatch({ effects: setPickLines.of(null) })
  expect(view.dom.querySelectorAll('.cm-pick-line')).toHaveLength(0)
  view.destroy()
})

it('clamps a range that runs past the end of the document', () => {
  const view = viewWith('a\nb')
  view.dispatch({ effects: setPickLines.of({ startLine: 2, endLine: 40 }) })
  expect([...view.dom.querySelectorAll('.cm-pick-line')].map((el) => el.textContent)).toEqual(['b'])
  view.destroy()
})
