import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { STARTER_CODE } from './test/fixtures'
import { errorResult, okResult } from './test/results'
import { App } from './App'
import { useRefineStore } from './refine/refineStore'
import { partPickFixture } from './test/picks'
import { useExportStore } from './export/exportStore'
import { emitLoadProgress } from './render/loadProgress'
import { usePrefs } from './settings/prefsStore'

vi.mock('./viewer/Viewer', () => ({
  Viewer: ({ stale, empty }: { stale: boolean; empty?: boolean }) => (
    <div data-testid="viewer" data-stale={String(stale)} data-empty={String(!!empty)} />
  ),
}))

beforeEach(async () => {
  await resetDb()
  useAppStore.setState({ ...useAppStore.getInitialState(), code: STARTER_CODE }, true)
  useChatStore.setState(useChatStore.getInitialState(), true)
  useProvidersStore.setState(useProvidersStore.getInitialState(), true)
  useExportStore.setState(useExportStore.getInitialState(), true)
})
afterEach(() => vi.unstubAllGlobals())
afterEach(() => Reflect.deleteProperty(window, 'matchMedia'))
afterEach(() => usePrefs.setState(usePrefs.getInitialState(), true))

function scriptedWorker(respond: (req: RenderRequest) => RenderResult) {
  const handle: RenderWorkerHandle = { render: async (req) => respond(req), terminate: () => {} }
  return () => handle
}

it('renders the default model, shows dims in the header, and enables STL export', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('heading', { name: 'ChatSCAD' })).toBeInTheDocument()
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
  expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()
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
  // The Customizer dock is a region under the viewer (M3); the console is a region inside the code column (M1).
  expect(regions).toEqual(['Chat', '3D view', 'Parameters', 'Code', 'Console'])
})

it('switches between the Project, History and Settings tabs, keeping the workbench mounted', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('workbench')).not.toBeVisible()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Back to project' })).toBeNull()
  expect(screen.getByText('Applies to every project')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Project' }))
  expect(screen.getByTestId('workbench')).toBeVisible()
  expect(screen.queryByTestId('settings')).toBeNull()
})

it('shows the first-run callout once providers have loaded, and Add a provider opens settings', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(await screen.findByText('Connect an AI model to start')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'No model' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Add a provider' }))
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
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
  expect(screen.getByTestId('project-cost')).toHaveTextContent('$0.011 this project')
  expect(screen.queryByTestId('chat-note')).toBeNull()
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeEnabled()
})

vi.mock('./history/HistoryView', () => ({ HistoryView: () => <div data-testid="history-view" /> }))
vi.mock('./gallery/GalleryView', () => ({ GalleryView: () => <div data-testid="gallery-view" /> }))

describe('M3', () => {
  it('blocks STL export from a slider change until the render with those values finishes', async () => {
    const requests: RenderRequest[] = []
    const pending: Array<() => void> = []
    const handle = {
      render: (req: RenderRequest) =>
        new Promise<RenderResult>((resolve) => {
          // M5's tagged follow-up only feeds picking; answer it at once so the slider render is the pending one.
          if (req.preview) return resolve(okResult())
          requests.push(req)
          if (requests.length === 1) resolve(okResult())
          else pending.push(() => resolve(okResult()))
        }),
      terminate: () => {},
    }
    render(<App createWorker={() => handle} />)
    const exportStl = () => screen.getByRole('button', { name: 'Export STL' })
    await waitFor(() => expect(exportStl()).toBeEnabled())

    fireEvent.change(screen.getByRole('slider', { name: 'width' }), { target: { value: '30' } })
    expect(exportStl()).toBeDisabled()
    expect(exportStl()).toHaveAttribute('title', 'Wait for the render to finish')
    await waitFor(() => expect(requests.at(-1)).toEqual(expect.objectContaining({ params: { width: 30 } })), { timeout: 3_000 })
    expect(exportStl()).toBeDisabled()
    act(() => pending.shift()!())
    await waitFor(() => expect(exportStl()).toBeEnabled())
  })

  it('shows the Customizer dock under the viewer and the Problems tab in the code pane', async () => {
    render(<App createWorker={scriptedWorker(() => okResult())} />)
    expect(screen.getByRole('region', { name: 'Parameters' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Dimensions' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Problems/ })).toBeInTheDocument()
  })

  it('switches to the History and Examples views', () => {
    render(<App createWorker={scriptedWorker(() => okResult())} />)
    act(() => useAppStore.getState().setView('history'))
    expect(screen.getByTestId('history-view')).toBeInTheDocument()
    expect(screen.getByTestId('workbench')).not.toBeVisible()
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    act(() => useAppStore.getState().setView('gallery'))
    expect(screen.getByTestId('gallery-view')).toBeInTheDocument()
    act(() => useAppStore.getState().setView('workbench'))
    expect(screen.getByRole('region', { name: '3D view' })).toBeInTheDocument()
  })
})

it('shows the OpenSCAD download progress in the pill before the first render', () => {
  render(<App createWorker={() => ({ render: () => new Promise<RenderResult>(() => {}), terminate: () => {} })} />)
  act(() => emitLoadProgress({ loaded: 5_200_000, total: 8_400_000 }))
  expect(screen.getByTestId('render-status')).toHaveTextContent('Loading OpenSCAD 5.2 / 8.4 MB')
})

it('renders a quick $fn = 12 pass before the full render when the setting is on', async () => {
  usePrefs.setState({ lowQualityPreview: true })
  const seen: RenderRequest[] = []
  render(
    <App
      createWorker={scriptedWorker((req) => {
        seen.push(req)
        return okResult()
      })}
    />,
  )
  await waitFor(() => expect(screen.getByTestId('render-status')).toHaveTextContent(/^Rendered/))
  expect(seen[0].params).toMatchObject({ $fn: 12 })
  expect(seen[1].params ?? {}).not.toHaveProperty('$fn')
})

it('opens the export dialog on the Link tab from Share', async () => {
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  await userEvent.click(screen.getByRole('button', { name: 'Share' }))
  const dialog = screen.getByRole('dialog', { name: 'Export and share' })
  expect(within(dialog).getByRole('tab', { name: 'Link' })).toHaveAttribute('aria-selected', 'true')
})

function mockPhone() {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(max-width: 767.98px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

it('uses the Chat / Code / 3D panels under the Project, History and Settings tabs on a phone', () => {
  mockPhone()
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
  expect(screen.getByRole('tablist', { name: 'Panels' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  // The key row sits in the Code tab, which is hidden while Chat is shown.
  expect(screen.getByRole('toolbar', { name: 'Code symbols', hidden: true })).toBeInTheDocument()
})

it('shows the settings tab on a phone too, so a provider can be added', async () => {
  mockPhone()
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tablist', { name: 'Panels' })).toBeNull()
  await userEvent.click(screen.getByRole('tab', { name: 'Project' }))
  expect(screen.getByRole('tablist', { name: 'Panels' })).toBeInTheDocument()
})

it('highlights the picked part in the editor and clears it when the code changes', async () => {
  useRefineStore.setState(useRefineStore.getInitialState(), true)
  const { container } = render(<App createWorker={scriptedWorker(() => okResult())} />)
  await waitFor(() => expect(screen.getByTestId('dims')).toBeInTheDocument())
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'a();\nb();\nc();\n' } }))

  act(() => useRefineStore.setState({ pick: { ...partPickFixture(), scope: { startLine: 2, endLine: 2 } } }))
  expect([...container.querySelectorAll('.cm-pick-line')].map((el) => el.textContent)).toEqual(['b();'])

  act(() => view.dispatch({ changes: { from: 0, insert: '// edited\n' } }))
  await waitFor(() => expect(container.querySelectorAll('.cm-pick-line')).toHaveLength(0))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('opens an empty project without rendering anything', async () => {
  useAppStore.setState({ code: '' })
  const render$ = vi.fn(async () => okResult())
  render(<App createWorker={() => ({ render: render$, terminate: () => {} })} />)
  await waitFor(() => expect(screen.getByTestId('render-status')).toHaveTextContent('Nothing to render'))
  expect(screen.getByTestId('viewer')).toHaveAttribute('data-empty', 'true')
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  await new Promise((r) => setTimeout(r, 50))
  expect(render$).not.toHaveBeenCalled()
})

function wideWindow() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
}
afterEach(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }))

it('puts a resize divider between every desktop panel, sized from the saved layout', () => {
  wideWindow()
  usePrefs.setState({ panelLayout: { chatWidth: 420, codeWidth: 500, dockHeight: 200, consoleHeight: 150 } })
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  const names = screen.getAllByRole('separator').map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-valuenow')])
  expect(names).toEqual([
    ['Resize chat', '420'],
    ['Resize parameters', '200'],
    ['Resize code', '500'],
    ['Resize console', '150'],
  ])
})

it('saves a resized panel for this device', async () => {
  wideWindow()
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize chat' }), { key: 'ArrowRight' })
  expect(screen.getByRole('separator', { name: 'Resize chat' })).toHaveAttribute('aria-valuenow', '376')
  await waitFor(() => expect(usePrefs.getState().panelLayout.chatWidth).toBe(376))
})

it('has no resize dividers on a phone', () => {
  mockPhone()
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  expect(screen.queryAllByRole('separator')).toEqual([])
})

it('narrows the columns to fit a small window without changing the saved layout', () => {
  usePrefs.setState({ panelLayout: { chatWidth: 560, codeWidth: 720, dockHeight: null, consoleHeight: 176 } })
  render(<App createWorker={scriptedWorker(() => okResult())} />)
  // 1024 px: the 3D view keeps 360 px, the code column gives way first.
  expect(screen.getByRole('separator', { name: 'Resize code' })).toHaveAttribute('aria-valuenow', '320')
  expect(screen.getByRole('separator', { name: 'Resize chat' })).toHaveAttribute('aria-valuenow', '342')
  expect(usePrefs.getState().panelLayout.chatWidth).toBe(560)
})
