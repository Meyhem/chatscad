import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MeshData } from '../../render/types'
import { useAppStore } from '../../state/store'
import { okResult } from '../../test/results'
import { setViewerPose } from '../../viewer/viewerCamera'
import { presetPose, renderFrames, type CameraPose } from '../frames'
import { imageDataToPng } from '../png'
import { saveFile } from '../saveFile'
import { ImageTab } from './ImageTab'

vi.mock('../frames', async (importOriginal) => {
  const real = await importOriginal<typeof import('../frames')>()
  return {
    ...real,
    renderFrames: vi.fn(async function* (opts: { size: [number, number] }) {
      yield { width: opts.size[0], height: opts.size[1], data: new Uint8ClampedArray(4) } as unknown as ImageData
    }),
  }
})
vi.mock('../png', () => ({ imageDataToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }))
vi.mock('../saveFile', () => ({ saveFile: vi.fn(async () => 'downloaded') }))
vi.mock('../FramePreview', () => ({
  FramePreview: ({ label }: { label: string }) => <div data-testid="frame-preview">{label}</div>,
}))

let mesh: MeshData
beforeEach(() => {
  vi.clearAllMocks()
  setViewerPose(null)
  const r = okResult()
  if (!r.ok) throw new Error('fixture must succeed')
  mesh = r.mesh
  useAppStore.setState({ ...useAppStore.getInitialState(), mesh }, true)
})

const lastCall = () => vi.mocked(renderFrames).mock.calls.at(-1)![0]

it('saves a PNG at the chosen size, camera and background', async () => {
  render(<ImageTab />)
  await userEvent.selectOptions(screen.getByLabelText('Size'), '800 × 600 px')
  await userEvent.selectOptions(screen.getByLabelText('Camera'), 'Top')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Transparent background' }))
  await waitFor(() => expect(lastCall().size).toEqual([480, 360]))

  await userEvent.click(screen.getByRole('button', { name: 'Save PNG' }))
  await waitFor(() => expect(saveFile).toHaveBeenCalled())
  expect(lastCall()).toEqual({ mesh, size: [800, 600], background: null, cameras: [presetPose(mesh.bounds, 'top')] })
  expect(imageDataToPng).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600 }))
  expect(vi.mocked(saveFile).mock.calls[0][1]).toBe('model.png')
  expect(document.querySelectorAll('.pc-btn.is-primary')).toHaveLength(1)
})

it('defaults to the current view when the viewer has one, and to iso otherwise', async () => {
  const { unmount } = render(<ImageTab />)
  expect(screen.getByLabelText('Camera')).toHaveValue('iso')
  expect(screen.getByRole('option', { name: 'Current view' })).toBeDisabled()
  unmount()

  const pose: CameraPose = { position: [5, -50, 40], target: [10, 10, 5], up: [0, 0, 1] }
  setViewerPose(pose)
  render(<ImageTab />)
  expect(screen.getByLabelText('Camera')).toHaveValue('current')
  await waitFor(() => expect(lastCall().cameras).toEqual([pose]))
})

it('explains when there is nothing to export', () => {
  useAppStore.setState({ mesh: null })
  render(<ImageTab />)
  expect(screen.getByText('Nothing to export yet')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save PNG' })).toBeNull()
})
