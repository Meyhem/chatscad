import { act, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import userEvent from '@testing-library/user-event'
import { useChatStore } from './chat/chatStore'
import { newProfile, saveProfile } from './db/profiles'
import { updateSettings } from './db/settings'
import type { RenderWorkerHandle } from './render/createRenderWorker'
import type { RenderRequest, RenderResult } from './render/types'
import { useProvidersStore } from './settings/providersStore'
import { useAppStore } from './state/store'
import { resetDb } from './test/db'
import { errorResult, okResult } from './test/results'
import { App } from './App'

vi.mock('./viewer/Viewer', () => ({
  Viewer: ({ stale }: { stale: boolean }) => <div data-testid="viewer" data-stale={String(stale)} />,
}))

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useChatStore.setState(useChatStore.getInitialState(), true)
  useProvidersStore.setState(useProvidersStore.getInitialState(), true)
})
afterEach(() => vi.unstubAllGlobals())

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

it('disables STL export as soon as the code is edited, until the new code has rendered', async () => {
  const { container } = render(<App createWorker={scriptedWorker(() => okResult())} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled())
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'cube([1, 1, 1]);' } }))
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).toBeDisabled()
  expect(stl).toHaveAttribute('title', 'Wait for the render to finish')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled(), { timeout: 3_000 })
})

it('lays out chat, 3D view and code as the three workbench columns', () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
  // The console is a region inside the code column (M1).
  expect(regions).toEqual(['Chat', '3D view', 'Code', 'Console'])
})

it('opens the settings page from the header and comes back to the same workbench', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByTestId('workbench')).not.toBeVisible()
  expect(screen.queryByRole('dialog')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Back to project' }))
  expect(screen.getByTestId('workbench')).toBeVisible()
  expect(screen.queryByTestId('settings')).toBeNull()
})

it('shows the first-run callout once providers have loaded, and Add a provider opens settings', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(await screen.findByText('Connect an AI model to start')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'No model' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Add a provider' }))
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
})

function fakeLlm(reply: string) {
  const chunks = [
    { choices: [{ index: 0, delta: { content: reply } }] },
    { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 310, cost: 0.011 } },
  ]
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return vi.fn(async (input: string | URL | Request) =>
    String(input).endsWith('/models')
      ? Response.json({ data: [{ id: 'fake-model' }] })
      : new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  )
}

it('sends a prompt: the code of the reply reaches the editor, renders, and the cost shows, without stopping itself', async () => {
  vi.stubGlobal('fetch', fakeLlm('Made a block.\n\n```openscad\ncube([30, 20, 10]);\n```\n'))
  const profile = await saveProfile(
    newProfile({ name: 'Fake', adapter: 'openai-compatible', baseUrl: 'https://fake-llm.test/v1', defaultModel: 'fake-model' }),
  )
  await updateSettings({ activeProfileId: profile.id })
  const { container } = render(<App createWorker={scriptedWorker(() => okResult())} />)
  await screen.findByRole('button', { name: 'Model: fake-model' })

  await userEvent.type(screen.getByLabelText('Prompt'), 'A block{Enter}')

  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  await waitFor(() => expect(view.state.doc.toString()).toBe('cube([30, 20, 10]);\n'), { timeout: 3_000 })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument(), { timeout: 3_000 })
  expect(useAppStore.getState().codeSource).toBe('ai')
  expect(screen.getByTestId('chat-reply')).toHaveTextContent('Made a block.')
  expect(screen.getByTestId('msg-cost')).toHaveTextContent('1,310 tok · $0.011')
  expect(screen.getByTestId('chat-cost')).toHaveTextContent('$0.011 this chat')
  expect(screen.queryByTestId('chat-note')).toBeNull()
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled()
})
