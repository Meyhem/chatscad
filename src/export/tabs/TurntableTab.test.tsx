import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '../../state/store'
import { okResult } from '../../test/results'
import { saveFile } from '../saveFile'
import { exportTurntable } from '../turntable'
import { TurntableTab } from './TurntableTab'

vi.mock('../turntable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../turntable')>()),
  exportTurntable: vi.fn(),
}))
vi.mock('../frames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../frames')>()),
  renderFrames: vi.fn(async function* () {}),
}))
vi.mock('../saveFile', () => ({ saveFile: vi.fn(async () => 'downloaded') }))
vi.mock('../FramePreview', () => ({ FramePreview: () => <div data-testid="frame-preview" /> }))

let finish: (blob: Blob) => void
let signal: AbortSignal

beforeEach(() => {
  vi.clearAllMocks()
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  useAppStore.setState({ ...useAppStore.getInitialState(), mesh: r.mesh }, true)
  vi.mocked(exportTurntable).mockImplementation(async (opts) => {
    signal = opts.signal
    opts.onProgress({ done: 1, total: 72, bytes: 1_000 })
    return new Promise<Blob>((resolve, reject) => {
      finish = resolve
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason))
    })
  })
})

it('clamps the frame count, shows progress, and saves the GIF', async () => {
  render(<TurntableTab />)
  const frames = screen.getByLabelText('Frames')
  await userEvent.clear(frames)
  await userEvent.type(frames, '100')
  await userEvent.tab()
  expect(frames).toHaveValue('72')

  await userEvent.click(screen.getByRole('button', { name: 'Save GIF' }))
  expect(exportTurntable).toHaveBeenCalledWith(expect.objectContaining({ frames: 72, size: [480, 480], transparent: false }))
  expect(await screen.findByText('Rendering frames · 1 of 72 · about 0.1 MB')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save GIF' })).toBeDisabled()

  finish(new Blob(['GIF89a'], { type: 'image/gif' }))
  await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'model-turntable.gif'))
  expect(screen.getByRole('button', { name: 'Save GIF' })).toBeEnabled()
})

it('cancels without an error', async () => {
  render(<TurntableTab />)
  await userEvent.click(screen.getByRole('button', { name: 'Save GIF' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  expect(signal.aborted).toBe(true)
  await waitFor(() => expect(screen.queryByText(/Rendering frames/)).toBeNull())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(saveFile).not.toHaveBeenCalled()
})
