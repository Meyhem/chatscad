import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useProjectStore } from '../../history/projectStore'
import { ancestry, listVersions } from '../../history/versions'
import { version } from '../../test/versions'
import { saveFile } from '../saveFile'
import { renderTimelapse } from '../timelapse'
import { TimelapseTab } from './TimelapseTab'

vi.mock('../../history/versions', () => ({ ancestry: vi.fn(), listVersions: vi.fn() }))
vi.mock('../timelapse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../timelapse')>()),
  renderTimelapse: vi.fn(),
}))
vi.mock('../../render/sharedQueue', () => ({ getRenderQueue: () => ({ render: vi.fn() }) }))
vi.mock('../saveFile', () => ({ saveFile: vi.fn(async () => 'downloaded') }))
vi.mock('../FramePreview', () => ({ FramePreview: () => <div data-testid="frame-preview" /> }))

const v1 = version({ id: 'a', label: 'v1', createdAt: 1 })
const v2 = version({ id: 'b', parentId: 'a', label: 'v2', createdAt: 2 })
const v21 = version({ id: 'e', parentId: 'a', label: 'v2.1', kind: 'variant', variantGroupId: 'g', createdAt: 2.5 })
const v3 = version({ id: 'c', parentId: 'b', label: 'v3', createdAt: 3, compileStatus: 'error' })
const v4 = version({ id: 'd', parentId: 'c', label: 'v4', createdAt: 5 })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ancestry).mockResolvedValue([v4, v3, v2, v1])
  vi.mocked(listVersions).mockResolvedValue([v1, v2, v21, v3, v4])
  vi.mocked(renderTimelapse).mockResolvedValue({ blob: new Blob(['GIF89a'], { type: 'image/gif' }), frames: 3, failed: [] })
  useProjectStore.setState({ project: { id: 'project-1', name: 'Hook' }, head: v4 } as never)
})

it('describes which versions the timelapse shows and follows the switches', async () => {
  render(<TimelapseTab />)
  expect(await screen.findByText('v1 → v4 along the current branch. The failed v3 and 1 unpicked variant are skipped.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Include failed versions' }))
  expect(screen.getByText('v1 → v4 along the current branch. 1 unpicked variant is skipped.')).toBeInTheDocument()
  expect(ancestry).toHaveBeenCalledWith('d')
  expect(listVersions).toHaveBeenCalledWith('project-1')
})

it('renders the planned versions with the chosen timing and saves the GIF', async () => {
  render(<TimelapseTab />)
  await screen.findByText(/along the current branch/)
  const duration = screen.getByLabelText('Frame duration')
  await userEvent.clear(duration)
  await userEvent.type(duration, '1,5')
  await userEvent.click(screen.getByRole('button', { name: 'Save GIF' }))

  await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'model-timelapse.gif'))
  const [opts] = vi.mocked(renderTimelapse).mock.calls[0]
  expect(opts.versions.map((v) => v.label)).toEqual(['v1', 'v2', 'v4'])
  expect(opts).toMatchObject({ size: [480, 480], frameDelayMs: 1_500, holdMs: 2_000, caption: true, turntable: true })
  expect(document.querySelectorAll('.pc-btn.is-primary')).toHaveLength(1)
})

it('says which versions were left out because they no longer compile', async () => {
  vi.mocked(renderTimelapse).mockResolvedValue({ blob: new Blob(['GIF89a']), frames: 2, failed: ['v2'] })
  render(<TimelapseTab />)
  await screen.findByText(/along the current branch/)
  await userEvent.click(screen.getByRole('button', { name: 'Save GIF' }))
  expect(await screen.findByText('Left out v2: it no longer compiles.')).toBeInTheDocument()
})

it('needs at least two versions that compiled', async () => {
  vi.mocked(ancestry).mockResolvedValue([v1])
  vi.mocked(listVersions).mockResolvedValue([v1])
  render(<TimelapseTab />)
  expect(await screen.findByText('Only v1 so far.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save GIF' })).toBeDisabled()
  expect(screen.getByText('Needs at least two versions on this branch that compiled.')).toBeInTheDocument()
})
