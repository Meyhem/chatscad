import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Version } from '../db/db'
import { useAppStore } from '../state/store'
import { makeProject, makeVersion } from '../test/fixtures'
import { HistoryView } from './HistoryView'
import { saveProjectFile } from './projectFile'
import { useProjectStore } from './projectStore'

vi.mock('../viewer/Viewer', () => ({ Viewer: () => <div data-testid="preview-viewer" /> }))
vi.mock('./usePreviewRender', () => ({ usePreviewRender: () => ({ status: 'ok', mesh: null, renderMs: 431, error: null }) }))
vi.mock('../db/blobs', () => ({ getBlob: async () => undefined }))
vi.mock('../db/messages', () => ({
  messagesForVersion: async (id: string) =>
    id === 'v5' ? [{ id: 'm', role: 'assistant', content: 'Closed the translate() call on line 16. No other changes.' }] : [],
}))
vi.mock('../db/usageLinks', () => ({
  usageForVersion: async (id: string) => (id === 'v5' ? [{ inputTokens: 600, outputTokens: 40, cost: 0.002 }] : []),
}))
vi.mock('./projectFile', () => ({ saveProjectFile: vi.fn(async () => {}) }))

const NOW = 10_000_000
const min = 60_000
const v = (id: string, parentId: string | null, ago: number, over: Partial<Version> = {}) =>
  makeVersion({ id, label: id, parentId, createdAt: NOW - ago * min, ...over })

const versions = [
  v('v1', null, 21, { source: 'ai', message: 'A holder for four 18650 cells…', code: 'slots = 4;\n' }),
  v('v2', 'v1', 18, { source: 'ai', message: '<img src=x onerror=alert(1)>', code: 'slots = 4;\nwall = 2.4;\n' }),
  v('v3', 'v2', 12, { source: 'slider', message: 'height 18 → 22', code: 'slots = 4;\nwall = 2.4;\n', params: { slots: 5 } }),
  v('v3.1', 'v3', 10, { source: 'manual', message: 'Edited code · +1 −1 lines' }),
  v('v4', 'v3', 5, { source: 'ai', message: 'Make it hold 21700 cells', compileStatus: 'error' }),
  v('v5', 'v4', 4, { source: 'autofix', message: 'Auto-fix: closed translate() on line 16', model: 'claude-sonnet-5-5', renderMs: 431, code: 'slots = 4;\nbore = 21.5;\n' }),
  v('v6', 'v5', 0, { source: 'slider', message: 'slots 4 → 5' }),
]

const restore = vi.fn(async () => versions[0]!)
const branchFrom = vi.fn(async () => {})
const createWorker = () => ({ render: vi.fn(), terminate: vi.fn() })

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  restore.mockClear()
  branchFrom.mockClear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.getState().setView('history')
  useProjectStore.setState({ project: makeProject({ id: 'p1' }), versions, head: versions[6]!, restore, branchFrom })
})
afterEach(() => vi.restoreAllMocks())

const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.pc-version')]

it('lists versions as on the History screen: current first, failed dimmed, branch indented', () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  expect(screen.getByText('7 versions · 1 branch')).toBeInTheDocument()
  expect(rows(container).map((r) => r.querySelector('.t')!.textContent)).toEqual(['v6 · current', 'v5', 'v4', 'v3', 'v3.1', 'v2', 'v1'])
  const v4 = rows(container)[2]!
  expect(v4).toHaveClass('is-failed')
  expect(v4.querySelector('.m')).toHaveTextContent('Failed · Make it hold 21700 cells')
  expect(rows(container)[4]).toHaveClass('is-branch')
  expect(within(rows(container)[1]!).getByText('4 min')).toBeInTheDocument()
  expect(rows(container)[0]).toHaveAttribute('aria-current', 'true')
})

it('shows messages as text, never as HTML', () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  expect(container.querySelector('img')).toBeNull()
})

it('previews a selected version without moving the head, with its details and reply', async () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  expect(screen.getByText('Preview · v6')).toBeInTheDocument()
  expect(screen.getByText('current version')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Restore v6' })).toBeDisabled()

  fireEvent.click(rows(container)[1]!)
  expect(rows(container)[1]).toHaveAttribute('aria-current', 'true')
  expect(screen.getByText('Preview · v5')).toBeInTheDocument()
  expect(screen.getByText('not the current version')).toBeInTheDocument()
  expect(screen.getByText('v5 · Auto-fix')).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByTestId('preview-meta')).toHaveTextContent('claude-sonnet-5-5 · 4 min ago · rendered in 431 ms · 640 tok · $0.002'),
  )
  expect(screen.getByTestId('preview-message')).toHaveTextContent('Closed the translate() call on line 16. No other changes.')
  expect(useProjectStore.getState().head?.id).toBe('v6')
  expect(screen.getByText('Restoring makes a new version. Nothing is deleted.')).toBeInTheDocument()
})

it('compares the selected version with its parent by default, and any two versions on request', () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  fireEvent.click(rows(container)[3]!)
  expect(screen.getByRole('combobox', { name: 'From version' })).toHaveDisplayValue('v2')
  expect(screen.getByRole('combobox', { name: 'To version' })).toHaveDisplayValue('v3')
  expect(screen.getByTestId('param-diff')).toHaveTextContent('Parameters: slots 4 → 5')

  fireEvent.change(screen.getByRole('combobox', { name: 'From version' }), { target: { value: 'v1' } })
  expect(screen.getByTestId('diff-added')).toHaveTextContent('+1')
  expect(screen.getByTestId('diff-removed')).toHaveTextContent('−0')
  expect(container.querySelector('[data-kind="add"]')).toHaveTextContent('wall = 2.4;')
})

it('restores or branches from the previewed version and returns to the workbench', async () => {
  const { container } = render(<HistoryView createWorker={createWorker} />)
  fireEvent.click(rows(container)[1]!)
  fireEvent.click(screen.getByRole('button', { name: 'Restore v5' }))
  await waitFor(() => expect(restore).toHaveBeenCalledWith('v5'))
  await waitFor(() => expect(useAppStore.getState().view).toBe('workbench'))

  useAppStore.getState().setView('history')
  fireEvent.click(screen.getByRole('button', { name: 'Branch from here' }))
  await waitFor(() => expect(branchFrom).toHaveBeenCalledWith('v5'))
})

it('exports the project from the footer', () => {
  render(<HistoryView createWorker={createWorker} />)
  fireEvent.click(screen.getByRole('button', { name: 'Export project (.json)' }))
  expect(saveProjectFile).toHaveBeenCalledWith('p1')
})
