import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '../../state/store'
import { okResult } from '../../test/results'
import { saveFile } from '../saveFile'
import { renderFrames, type CameraPose } from '../frames'
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
vi.mock('../FramePreview', () => ({
  FramePreview: ({ frame, overlay }: { frame: ImageData | null; overlay?: React.ReactNode }) => (
    <div data-testid="frame-preview" data-frame={frame ? String(frame.width) : ''}>
      {overlay}
    </div>
  ),
}))

let finish: (blob: Blob) => void
let signal: AbortSignal

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(renderFrames).mockImplementation(async function* () {})
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

/** A fake frame whose width tags which render and which pose it came from. */
const fakeFrame = (tag: number) => ({ width: tag, height: 1 }) as ImageData

it('previews every turntable frame', async () => {
  render(<TurntableTab />)
  await waitFor(() => expect(renderFrames).toHaveBeenCalled())
  const call = vi.mocked(renderFrames).mock.calls.at(-1)![0] as { cameras: CameraPose[] }
  expect(call.cameras).toHaveLength(48)
})

it('restarts the preview when the frame count changes, without mixing in old frames', async () => {
  const releases: Array<() => void> = []
  vi.mocked(renderFrames).mockImplementation(async function* (opts: { cameras: CameraPose[] }) {
    const n = opts.cameras.length
    yield fakeFrame(n)
    await new Promise<void>((resolve) => releases.push(resolve))
    yield fakeFrame(n + 1000)
  } as unknown as typeof renderFrames)
  render(<TurntableTab />)
  await waitFor(() => expect(screen.getByTestId('frame-preview')).toHaveAttribute('data-frame', '48'))

  const frames = screen.getByLabelText('Frames')
  await userEvent.clear(frames)
  await userEvent.type(frames, '36')
  await userEvent.tab()
  await waitFor(() => expect(screen.getByTestId('frame-preview')).toHaveAttribute('data-frame', '36'))
  expect((vi.mocked(renderFrames).mock.calls.at(-1)![0] as { cameras: CameraPose[] }).cameras).toHaveLength(36)

  // The superseded 48-frame render finishes late; its frame must not appear.
  releases.forEach((r) => r())
  await waitFor(() => expect(screen.getByText('Rendering preview frames · 2 of 36')).toBeInTheDocument())
  expect(screen.queryByText(/of 48/)).toBeNull()
})

it('says how many preview frames are ready while it renders', async () => {
  vi.mocked(renderFrames).mockImplementation(async function* () {
    yield fakeFrame(1)
    yield fakeFrame(2)
    await new Promise(() => {})
  } as unknown as typeof renderFrames)
  render(<TurntableTab />)
  expect(await screen.findByText('Rendering preview frames · 2 of 48')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pause preview' })).toBeInTheDocument()
})

it('starts paused when the system asks for reduced motion', async () => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === '(prefers-reduced-motion: reduce)',
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  try {
    render(<TurntableTab />)
    await userEvent.click(screen.getByRole('button', { name: 'Play preview' }))
    expect(screen.getByRole('button', { name: 'Pause preview' })).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})
