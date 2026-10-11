import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useProjectStore } from '../history/projectStore'
import { createShareLink } from '../share/link'
import { useAppStore } from '../state/store'
import { okResult } from '../test/results'
import { ExportDialog } from './ExportDialog'
import { useExportStore } from './exportStore'
import { exportScad, exportStl, saveFile } from './saveFile'

vi.mock('./saveFile', () => ({
  saveFile: vi.fn(async () => 'downloaded'),
  exportStl: vi.fn(async () => 'downloaded'),
  exportScad: vi.fn(async () => 'downloaded'),
}))
vi.mock('../share/link', async (importOriginal) => {
  const real = await importOriginal<typeof import('../share/link')>()
  return { ...real, createShareLink: vi.fn(real.createShareLink) }
})

const writeText = vi.fn(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useExportStore.setState(useExportStore.getInitialState(), true)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  useProjectStore.setState({ project: { id: 'p1', name: 'Broom hook' } } as never)
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  const params = { wall: 2 }
  useAppStore.setState({ code: 'cube(1);', params, status: 'ok', mesh: r.mesh, stl: r.stl, renderedCode: 'cube(1);', renderedParams: params } as never)
})

const readText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsText(blob)
  })

const primary = () => document.querySelectorAll('[role="dialog"] .pc-btn.is-primary')

it('opens on the requested tab and switches tabs', async () => {
  useExportStore.getState().openAt('link')
  render(<ExportDialog />)
  const dialog = screen.getByRole('dialog', { name: 'Export and share' })
  expect(within(dialog).getByRole('tab', { name: 'Link' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Model file' }))
  expect(within(dialog).getByRole('tab', { name: 'Model file' })).toHaveAttribute('aria-selected', 'true')
  expect(useExportStore.getState().tab).toBe('model')
})

it('exports STL and .scad from the Model file tab', async () => {
  useExportStore.getState().openAt('model')
  render(<ExportDialog />)
  expect(primary()).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Export STL' }))
  await userEvent.click(screen.getByRole('button', { name: 'Export .scad' }))
  expect(exportStl).toHaveBeenCalledOnce()
  expect(exportScad).toHaveBeenCalledWith('cube(1);')
})

it('explains why STL export is blocked', () => {
  useAppStore.setState({ status: 'error' })
  useExportStore.getState().openAt('model')
  render(<ExportDialog />)
  expect(screen.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  expect(screen.getByText('Fix the error first, so the file matches the code')).toBeInTheDocument()
})

it('shows and copies a link carrying the project name, code and parameter values', async () => {
  useExportStore.getState().openAt('link')
  render(<ExportDialog />)
  const input = screen.getByRole('textbox', { name: 'Share link' })
  expect((input as HTMLInputElement).value).toMatch(/#s=[A-Za-z0-9+\-$]+$/)
  expect(createShareLink).toHaveBeenCalledWith({ v: 1, name: 'Broom hook', code: 'cube(1);', params: { wall: 2 } }, window.location.href)
  expect(screen.getByText(/KB · Code and parameter values only\. No keys, chat or history\./)).toBeInTheDocument()
  expect(primary()).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Copy link' }))
  expect(writeText).toHaveBeenCalledWith((input as HTMLInputElement).value)
  expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
})

it('warns about a long link and offers the .json file instead', async () => {
  vi.mocked(createShareLink).mockReturnValueOnce({
    url: 'https://example.test/#s=long',
    bytes: 9_400,
    level: 'long',
    payload: { v: 1, name: 'Broom hook', code: 'cube(1);', params: { wall: 2 } },
  })
  useExportStore.getState().openAt('link')
  render(<ExportDialog />)
  expect(screen.getByText('Long link: 9.4 KB')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Save .json instead' }))
  const [blob, name] = vi.mocked(saveFile).mock.calls[0]
  expect(name).toBe('broom-hook.json')
  expect(JSON.parse(await readText(blob))).toEqual({ v: 1, name: 'Broom hook', code: 'cube(1);', params: { wall: 2 } })
})

it('hides a link that is too long to open', () => {
  vi.mocked(createShareLink).mockReturnValueOnce({
    url: null,
    bytes: 20_000,
    level: 'too-long',
    payload: { v: 1, name: 'Broom hook', code: 'cube(1);', params: {} },
  })
  useExportStore.getState().openAt('link')
  render(<ExportDialog />)
  expect(screen.queryByRole('textbox', { name: 'Share link' })).toBeNull()
  expect(screen.getByText('Too large for a link')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled()
})

it('closes with the Close button', async () => {
  useExportStore.getState().openAt('model')
  render(<ExportDialog />)
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(useExportStore.getState().open).toBe(false)
})
