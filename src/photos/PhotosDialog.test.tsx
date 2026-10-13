import 'fake-indexeddb/auto'
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useAgentStore } from '../agent/agentStore'
import { useChatStore } from '../chat/chatStore'
import { db } from '../db/db'
import { loadImage } from '../db/images'
import { useProjectStore } from '../history/projectStore'
import { resetDb } from '../test/resetDb'
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

it('saves the photos and says so when a run starts while they are saved, instead of refining', async () => {
  useChatStore.setState({ messages: [], busy: false })
  let finish = () => {}
  const setPhotos = vi.fn(() => new Promise<void>((r) => (finish = r)))
  useProjectStore.setState({ setPhotos, setBrief: vi.fn(async () => {}) } as never)
  const refine = vi.fn(async () => {})
  useAgentStore.setState({ refineWithPhotos: refine } as never)
  const onClose = vi.fn()
  render(<PhotosDialog onClose={onClose} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} />)
  await screen.findByRole('img', { name: 'Front photo' })
  fireEvent.click(screen.getByRole('button', { name: 'Refine with 1 photo' }))
  await waitFor(() => expect(setPhotos).toHaveBeenCalled())
  useChatStore.setState({ busy: true })
  finish()
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(refine).not.toHaveBeenCalled()
  expect(useChatStore.getState().messages).toEqual([expect.objectContaining({ role: 'note', text: 'Photos saved. Refine when the current run finishes.' })])
  useChatStore.setState({ busy: false, messages: [] })
})

it('takes a photo dropped anywhere in the dialog as another angle, and keeps the tab on the app', async () => {
  render(<PhotosDialog onClose={() => {}} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} prepare={async (b) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })} />)
  await screen.findByRole('img', { name: 'Front photo' })
  const target = screen.getByLabelText('Description')
  const drop = createEvent.drop(target, { dataTransfer: { files: [new File(['o'], 'o.jpg', { type: 'image/jpeg' })], types: ['Files'] } })
  fireEvent(target, drop)
  expect(drop.defaultPrevented).toBe(true)
  expect(await screen.findByRole('img', { name: 'Other angle photo' })).toBeInTheDocument()
  expect(screen.getByText('2 of 5 photos')).toBeInTheDocument()
})

it('adds a photo dropped on a slot once, with that slot’s angle', async () => {
  render(<PhotosDialog onClose={() => {}} load={async () => new Blob(['f'], { type: 'image/jpeg' })} objectUrl={() => 'blob:a'} prepare={async (b) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })} />)
  await screen.findByRole('img', { name: 'Front photo' })
  fireEvent.drop(screen.getByLabelText('Add top photo').closest('label')!, { dataTransfer: { files: [new File(['t'], 't.jpg', { type: 'image/jpeg' })], types: ['Files'] } })
  expect(await screen.findByRole('img', { name: 'Top photo' })).toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 10))
  expect(screen.getByText('2 of 5 photos')).toBeInTheDocument()
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

describe('photo blobs', () => {
  const jpeg = (text: string) => new Blob([text], { type: 'image/jpeg' })
  const prepare = async (b: Blob) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })
  const message = (imageBlobIds: string[]) => ({ id: 'm', projectId: 'p', versionId: null, role: 'user' as const, content: 'A bracket', imageBlobIds, audioTranscript: null, model: null, usageId: null, createdAt: 1 })

  beforeEach(async () => {
    await resetDb()
    await db.blobs.put({ id: 'blob-a', kind: 'image', data: jpeg('f') })
  })

  async function removeFrontAndSave() {
    useProjectStore.setState({ setPhotos: vi.fn(async () => {}), setBrief: vi.fn(async () => {}) } as never)
    const onClose = vi.fn()
    render(<PhotosDialog onClose={onClose} objectUrl={() => 'blob:a'} />)
    await screen.findByRole('img', { name: 'Front photo' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove front photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save photos only' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  }

  it('deletes the blob of a removed photo once saved, when no message shows it', async () => {
    await removeFrontAndSave()
    await waitFor(async () => expect(await loadImage('blob-a')).toBeNull())
  })

  it('keeps the blob of a removed photo that a message still shows', async () => {
    await db.messages.put(message(['blob-a']))
    await removeFrontAndSave()
    await new Promise((r) => setTimeout(r, 20))
    expect(await loadImage('blob-a')).not.toBeNull()
  })

  async function failedSave() {
    const setPhotos = vi.fn(async (): Promise<void> => {
      throw new Error('Quota exceeded')
    })
    useProjectStore.setState({ setPhotos, setBrief: vi.fn(async () => {}) } as never)
    const onClose = vi.fn()
    const view = render(<PhotosDialog onClose={onClose} objectUrl={() => 'blob:a'} prepare={prepare} />)
    await screen.findByRole('img', { name: 'Front photo' })
    fireEvent.change(screen.getByLabelText('Add top photo'), { target: { files: [new File(['t'], 'top.jpg', { type: 'image/jpeg' })] } })
    await screen.findByRole('img', { name: 'Top photo' })
    fireEvent.click(screen.getByRole('button', { name: 'Save photos only' }))
    await screen.findByRole('alert')
    const orphan = (await db.blobs.toCollection().primaryKeys()).find((id) => id !== 'blob-a')!
    expect(await loadImage(orphan)).not.toBeNull()
    return { setPhotos, onClose, view, orphan }
  }

  it('deletes a photo saved by a failed attempt when the dialog closes', async () => {
    const { view, orphan } = await failedSave()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    view.unmount()
    await waitFor(async () => expect(await loadImage(orphan)).toBeNull())
    expect(await loadImage('blob-a')).not.toBeNull()
  })

  it('deletes a photo saved by a failed attempt and then removed, once a save succeeds', async () => {
    const { setPhotos, onClose, orphan } = await failedSave()
    setPhotos.mockImplementation(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Remove top photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save photos only' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    await waitFor(async () => expect(await loadImage(orphan)).toBeNull())
  })

  it('keeps a retried photo saved once, and its blob after the dialog closes', async () => {
    const { setPhotos, onClose, view, orphan } = await failedSave()
    setPhotos.mockImplementation(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Save photos only' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setPhotos).toHaveBeenLastCalledWith([project.photos[0], expect.objectContaining({ blobId: orphan, angle: 'top' })])
    view.unmount()
    await new Promise((r) => setTimeout(r, 20))
    expect(await loadImage(orphan)).not.toBeNull()
    expect(await db.blobs.count()).toBe(2)
  })

  it('cannot be closed while saving', async () => {
    let finish = () => {}
    useProjectStore.setState({ setPhotos: vi.fn(() => new Promise<void>((r) => (finish = r))), setBrief: vi.fn(async () => {}) } as never)
    const onClose = vi.fn()
    render(<PhotosDialog onClose={onClose} objectUrl={() => 'blob:a'} />)
    await screen.findByRole('img', { name: 'Front photo' })
    fireEvent.click(screen.getByRole('button', { name: 'Save photos only' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
