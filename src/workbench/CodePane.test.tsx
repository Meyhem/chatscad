import { act, fireEvent, render, screen } from '@testing-library/react'
import { useProjectStore } from '../history/projectStore'
import { flushRecorder } from '../history/recorder'
import { useAppStore } from '../state/store'
import { makeVersion } from '../test/fixtures'
import { errorResult, okResult } from '../test/results'
import { failedResult } from '../render/result'
import { CodePane } from './CodePane'

vi.mock('../history/recorder', () => ({ flushRecorder: vi.fn() }))

const CODE = 'w = 10; // [1:50]\ncube(w);'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('https://files.openscad.org/snapshots/OpenSCAD-2026.10.08-WebAssembly-web.zip\n')))
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.getState().setCode(CODE)
  useAppStore.getState().setParams({ w: 20 })
  useProjectStore.setState({ head: makeVersion({ id: 'v3', label: 'v3', code: CODE, params: { w: 20 }, source: 'slider' }) })
})
afterEach(() => vi.unstubAllGlobals())

it('shows the head version and how it was made, or that the editor has unsaved changes', () => {
  render(<CodePane />)
  expect(screen.getByTestId('version-caption')).toHaveTextContent('v3 · edited by slider')
  act(() => useAppStore.getState().setParams({ w: 21 }))
  expect(screen.getByTestId('version-caption')).toHaveTextContent('v3 · editing')
})

it('names the engine version in the console head', async () => {
  render(<CodePane />)
  expect(await screen.findByText('OpenSCAD 2026.10.08 · manifold')).toBeInTheDocument()
})

it('lists problems with a count in the error colour and jumps to a line from the list', () => {
  const { container } = render(<CodePane />)
  act(() => useAppStore.getState().renderFinished(errorResult(), CODE, { w: 20 }))
  const tab = screen.getByRole('tab', { name: /Problems/ })
  expect(tab).toHaveTextContent('Problems1')
  expect(tab.querySelector('.text-error')).toHaveTextContent('1')

  const editor = container.querySelector('.cm-editor')
  fireEvent.click(tab)
  expect(tab).toHaveAttribute('aria-selected', 'true')
  expect(container.querySelector('.cm-editor')).toBe(editor)
  fireEvent.click(screen.getByRole('button', { name: 'Line 1 · Parser error: syntax error' }))
  expect(screen.getByRole('tab', { name: 'main.scad' })).toHaveAttribute('aria-selected', 'true')
  expect(useAppStore.getState().reveal?.line).toBe(1)
})

it('lists a failure without a line, and says when there are no problems', () => {
  render(<CodePane />)
  act(() => useAppStore.getState().renderFinished(failedResult('Render timed out after 60 s'), CODE, {}))
  fireEvent.click(screen.getByRole('tab', { name: /Problems/ }))
  expect(screen.getByTestId('problems')).toHaveTextContent('Render timed out after 60 s')
  act(() => useAppStore.getState().renderFinished(okResult(), CODE, { w: 20 }))
  expect(screen.getByTestId('problems')).toHaveTextContent('No problems in the last render.')
})

it('commits pending edits when the editor loses focus', () => {
  const { container } = render(<CodePane />)
  fireEvent.blur(container.querySelector('.cm-content')!)
  expect(flushRecorder).toHaveBeenCalled()
})
