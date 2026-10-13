import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MeshData } from '../../render/types'
import { useAppStore } from '../../state/store'
import { okResult } from '../../test/results'
import { imageDataToPng } from '../png'
import { saveFile } from '../saveFile'
import { SHEET_SIZE } from '../sheet'
import { renderSheet } from '../sheetRender'
import { previewSize } from '../sizes'
import { DrawingTab } from './DrawingTab'

vi.mock('../sheetRender', () => ({
  renderSheet: vi.fn(
    async (opts: { size: [number, number] }) => ({ width: opts.size[0], height: opts.size[1], data: new Uint8ClampedArray(4) }) as unknown as ImageData,
  ),
}))
vi.mock('../png', () => ({ imageDataToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }))
vi.mock('../saveFile', () => ({ saveFile: vi.fn(async () => 'downloaded') }))
vi.mock('../FramePreview', () => ({
  FramePreview: ({ label }: { label: string }) => <div data-testid="frame-preview">{label}</div>,
}))
vi.mock('../../theme/tokens', () => ({ readToken: (name: string) => `token:${name}` }))

const COLOURS = {
  paper: 'token:sheet-paper',
  ink: 'token:sheet-ink',
  muted: 'token:sheet-muted',
  fontSans: 'token:font-sans',
  fontMono: 'token:font-mono',
}

let mesh: MeshData
let stl: ArrayBuffer
beforeEach(() => {
  vi.clearAllMocks()
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  mesh = r.mesh
  stl = r.stl
  useAppStore.setState(
    { ...useAppStore.getInitialState(), mesh, stl, status: 'ok', code: 'cube(20);', renderedCode: 'cube(20);', params: {}, renderedParams: {} },
    true,
  )
})

it('previews the sheet and saves it as a PNG drawn with the fixed sheet tokens', async () => {
  render(<DrawingTab />)
  await waitFor(() => expect(renderSheet).toHaveBeenCalledWith({ mesh, size: previewSize(SHEET_SIZE, 960), colours: COLOURS }))
  expect(screen.getByTestId('frame-preview')).toHaveTextContent('Preview of the drawing')
  expect(screen.getByText('A4 landscape, 2339 × 1654 px')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Save PNG' }))
  await waitFor(() => expect(saveFile).toHaveBeenCalled())
  expect(vi.mocked(renderSheet).mock.calls.at(-1)![0]).toEqual({ mesh, size: SHEET_SIZE, colours: COLOURS })
  expect(imageDataToPng).toHaveBeenCalledWith(expect.objectContaining({ width: 2339, height: 1654 }))
  expect(vi.mocked(saveFile).mock.calls[0][1]).toBe('model-drawing.png')
})

it('refuses a stale render and says why, without drawing anything', () => {
  useAppStore.setState({ code: 'cube(30);', status: 'rendering' })
  render(<DrawingTab />)
  expect(screen.getByText('The drawing needs a current render')).toBeInTheDocument()
  expect(screen.getByText('Wait for the render to finish.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save PNG' })).toBeNull()
  expect(renderSheet).not.toHaveBeenCalled()
})

it('refuses after a failed render', () => {
  useAppStore.setState({ status: 'error' })
  render(<DrawingTab />)
  expect(screen.getByText('Fix the error first, so the file matches the code.')).toBeInTheDocument()
})

it('refuses edited code even while the old render still counts as ok', () => {
  useAppStore.setState({ code: 'cube(30);' })
  render(<DrawingTab />)
  expect(screen.getByText('Wait for the render to finish.')).toBeInTheDocument()
})

it('explains when there is nothing to export', () => {
  useAppStore.setState({ mesh: null })
  render(<DrawingTab />)
  expect(screen.getByText('Nothing to export yet')).toBeInTheDocument()
})

it('says what failed when the preview cannot be drawn', async () => {
  vi.mocked(renderSheet).mockRejectedValueOnce(new Error('The browser has no 2D canvas to draw the sheet'))
  render(<DrawingTab />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not draw the preview: The browser has no 2D canvas to draw the sheet')
})
