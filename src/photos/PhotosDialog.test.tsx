import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useAgentStore } from '../agent/agentStore'
import { useChatStore } from '../chat/chatStore'
import { useProjectStore } from '../history/projectStore'
import { PhotosDialog } from './PhotosDialog'

const project = {
  id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'photos' as const,
  photos: [{ id: 'a', blobId: 'blob-a', angle: 'front' as const, addedAt: 1 }], brief: 'A bracket', scale: 'reference' as const,
}

const head = { id: 'v1', projectId: 'p', parentId: null, label: 'v1', code: '', createdAt: 1, source: 'ai' as const, compileStatus: 'ok' as const }

beforeEach(() => {
  Object.assign(URL, { revokeObjectURL: vi.fn() })
  useProjectStore.setState({ project })
})

it('shows the project photos and the description, and saves without refining', async () => {
  const setPhotos = vi.fn(async () => {})
  const setBrief = vi.fn(async () => {})
  useProjectStore.setState({ setPhotos, setBrief } as never)
  const onClose = vi.fn()
  render(<PhotosDialog onClose={onClose} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} />)
  expect(await screen.findByRole('img', { name: 'Front photo' })).toBeInTheDocument()
  expect(screen.getByText('1 of 5 photos')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A bracket, 50 mm tall' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save photos only' }))
  await waitFor(() => expect(setBrief).toHaveBeenCalledWith('A bracket, 50 mm tall'))
  expect(setPhotos).toHaveBeenCalledWith(project.photos)
  expect(onClose).toHaveBeenCalled()
})

it('adds a photo, saves its blob and refines with the new angle', async () => {
  const setPhotos = vi.fn(async () => {})
  const setBrief = vi.fn(async () => {})
  useProjectStore.setState({ setPhotos, setBrief } as never)
  const refine = vi.fn(async () => {})
  useAgentStore.setState({ refineWithPhotos: refine } as never)
  render(<PhotosDialog onClose={() => {}} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} prepare={async (b) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })} saveImage={async () => 'blob-side'} />)
  await screen.findByRole('img', { name: 'Front photo' })
  fireEvent.change(screen.getByLabelText('Add side photo'), { target: { files: [new File(['s'], 'side.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('img', { name: 'Side photo' })
  expect(screen.getByRole('button', { name: 'Refine with 2 photos' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Refine with 2 photos' }))
  await waitFor(() => expect(refine).toHaveBeenCalledWith(['side']))
  expect(setPhotos).toHaveBeenCalledWith([project.photos[0], expect.objectContaining({ blobId: 'blob-side', angle: 'side' })])
})

it('names the version a refine builds and the one that stays in History', async () => {
  useProjectStore.setState({ head, versions: [head] } as never)
  render(<PhotosDialog onClose={() => {}} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} />)
  await screen.findByRole('img', { name: 'Front photo' })
  expect(screen.getByText('Refining builds v2 from v1')).toBeInTheDocument()
  expect(screen.getByText('The agent compares the model with the photo and fixes what differs. Sizes you set keep their values. Guessed sizes may change.')).toBeInTheDocument()
  expect(screen.getByText('v1 stays in History.')).toBeInTheDocument()
})

it('drops a removed photo, and cannot refine with none left', async () => {
  const setPhotos = vi.fn(async () => {})
  useProjectStore.setState({ setPhotos, setBrief: vi.fn(async () => {}) } as never)
  render(<PhotosDialog onClose={() => {}} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} />)
  await screen.findByRole('img', { name: 'Front photo' })
  fireEvent.click(screen.getByRole('button', { name: 'Remove front photo' }))
  expect(screen.getByText('0 of 5 photos')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Refine with 0 photos' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save photos only' }))
  await waitFor(() => expect(setPhotos).toHaveBeenCalledWith([]))
})

it('keeps the dialog and the draft open when saving fails, and says why', async () => {
  useProjectStore.setState({ setPhotos: vi.fn(async () => {}), setBrief: vi.fn(async () => {}) } as never)
  const onClose = vi.fn()
  const refine = vi.fn(async () => {})
  useAgentStore.setState({ refineWithPhotos: refine } as never)
  render(
    <PhotosDialog
      onClose={onClose}
      load={async () => new Blob(['f'], { type: 'image/jpeg' })}
      objectUrl={() => 'blob:a'}
      prepare={async (b) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })}
      saveImage={async () => {
        throw new Error('Quota exceeded')
      }}
    />,
  )
  await screen.findByRole('img', { name: 'Front photo' })
  fireEvent.change(screen.getByLabelText('Add top photo'), { target: { files: [new File(['t'], 'top.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('img', { name: 'Top photo' })
  fireEvent.click(screen.getByRole('button', { name: 'Refine with 2 photos' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the photos: Quota exceeded')
  expect(onClose).not.toHaveBeenCalled()
  expect(refine).not.toHaveBeenCalled()
  expect(screen.getByRole('img', { name: 'Top photo' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Refine with 2 photos' })).toBeEnabled()
})

it('cannot refine while the agent is working', async () => {
  useChatStore.setState({ busy: true })
  render(<PhotosDialog onClose={() => {}} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} />)
  await screen.findByRole('img', { name: 'Front photo' })
  expect(screen.getByRole('button', { name: 'Refine with 1 photo' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save photos only' })).toBeEnabled()
  useChatStore.setState({ busy: false })
})

it('says when the photos cannot be loaded, and will not save over them', async () => {
  const setPhotos = vi.fn(async () => {})
  useProjectStore.setState({ setPhotos, setBrief: vi.fn(async () => {}) } as never)
  render(
    <PhotosDialog
      onClose={() => {}}
      load={async () => {
        throw new Error('Database closed')
      }}
      objectUrl={() => 'blob:a'}
    />,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the photos: Database closed')
  expect(screen.getByRole('button', { name: 'Save photos only' })).toBeDisabled()
  expect(screen.getByRole('button', { name: /^Refine with/ })).toBeDisabled()
})
