import { fireEvent, render, screen } from '@testing-library/react'
import { useProjectStore } from '../history/projectStore'
import { usePoseRequest } from '../viewer/poseRequest'
import { ReferencePhoto } from './ReferencePhoto'

const bounds = { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number] }
const photos = [
  { id: 'a', blobId: 'ba', angle: 'front' as const, addedAt: 1 },
  { id: 'b', blobId: 'bb', angle: 'other' as const, addedAt: 2 },
]

beforeEach(() => {
  useProjectStore.setState({ project: { id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'photos', photos } })
  usePoseRequest.setState({ pose: null, token: 0 })
})

it('shows the first photo, switches with the tabs, moves the camera for tagged angles only, and hides', async () => {
  render(<ReferencePhoto bounds={bounds} load={async (id) => new Blob([id], { type: 'image/jpeg' })} objectUrl={() => 'blob:x'} />)
  expect(await screen.findByRole('img', { name: 'Reference photo, front' })).toBeInTheDocument()
  expect(screen.getByText("The camera matches the photo's angle.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Front' }))
  expect(usePoseRequest.getState().token).toBe(1)
  fireEvent.click(screen.getByRole('radio', { name: 'Other angle' }))
  expect(usePoseRequest.getState().token).toBe(1)
  expect(screen.queryByText("The camera matches the photo's angle.")).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Hide reference photo' }))
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByRole('button', { name: 'Show reference photo' })).toBeInTheDocument()
})

it('renders nothing for a project without photos', () => {
  useProjectStore.setState({ project: { id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'blank' } })
  const { container } = render(<ReferencePhoto bounds={bounds} />)
  expect(container).toBeEmptyDOMElement()
})
