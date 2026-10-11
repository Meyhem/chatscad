import { render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import userEvent from '@testing-library/user-event'
import type { RenderWorkerHandle } from './render/createRenderWorker'
import type { RenderRequest, RenderResult } from './render/types'
import { useAppStore } from './state/store'
import { errorResult, okResult } from './test/results'
import { App } from './App'

vi.mock('./viewer/Viewer', () => ({
  Viewer: ({ stale }: { stale: boolean }) => <div data-testid="viewer" data-stale={String(stale)} />,
}))

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

function scriptedWorker(respond: (req: RenderRequest) => RenderResult) {
  const handle: RenderWorkerHandle = { render: async (req) => respond(req), terminate: () => {} }
  return () => handle
}

it('renders the default model, shows dims in the header, and enables STL export', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('heading', { name: 'PromptCAD' })).toBeInTheDocument()
  expect(screen.getByTestId('viewer')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'main.scad' })).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => expect(screen.getByTestId('dims')).toHaveTextContent('20 × 20 × 10 mm'))
  expect(screen.getByTestId('render-status')).toHaveTextContent('Rendered 12 ms')
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled()
  expect(screen.getByTestId('viewer')).toHaveAttribute('data-stale', 'false')
})

it('keeps the last mesh (dimmed) but disables STL export after a failed edit, without a dialog', async () => {
  const { container } = render(
    <App createWorker={scriptedWorker((req) => (req.code.includes('broken') ? errorResult() : okResult()))} />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled())

  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'broken(' } })

  await waitFor(() => expect(screen.getByTestId('render-status')).toHaveTextContent('Failed · line 1'), { timeout: 3_000 })
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).toBeDisabled()
  expect(stl).toHaveAttribute('title', 'Fix the error first, so the file matches the code')
  expect(screen.getByRole('button', { name: 'Export .scad' })).toBeEnabled()
  expect(screen.getByTestId('dims')).toHaveTextContent('20 × 20 × 10 mm')
  expect(screen.getByTestId('viewer')).toHaveAttribute('data-stale', 'true')
  expect(screen.getByTestId('console')).toHaveTextContent('ERROR: Parser error')
  expect(screen.getByTestId('console')).toHaveTextContent('OpenSCAD exited with code 1 · 5 ms')
  expect(container.querySelector('.cm-diag-callout')).toHaveTextContent('Line 1: Parser error: syntax error')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('clicking the failed status pill selects the error line in the editor', async () => {
  const { container } = render(
    <App createWorker={scriptedWorker((req) => (req.code.includes('broken') ? errorResult() : okResult()))} />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled())
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'cube(1);\nbroken(' }, selection: { anchor: 0 } })
  const pill = await screen.findByRole('button', { name: 'Failed · line 1' }, { timeout: 3_000 })
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  await userEvent.click(pill)
  expect(view.state.selection.main.head).toBe(0)
})
