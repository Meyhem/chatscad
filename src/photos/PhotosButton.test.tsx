import { fireEvent, render, screen } from '@testing-library/react'
import { useProjectStore } from '../history/projectStore'
import { PhotosButton } from './PhotosButton'
import { usePhotosDialog } from './photosDialogStore'

const base = { id: 'p', name: 'P', createdAt: 1, updatedAt: 1, headVersionId: null, providerProfileId: null, enabledLibraries: [] }

it('counts the photos and opens the dialog', () => {
  useProjectStore.setState({ project: { ...base, origin: 'photos', photos: [{ id: 'a', blobId: 'b', angle: 'front', addedAt: 1 }, { id: 'c', blobId: 'd', angle: 'top', addedAt: 2 }] } })
  render(<PhotosButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Photos · 2' }))
  expect(usePhotosDialog.getState().open).toBe(true)
})

it('is absent on a project that did not start from photos', () => {
  useProjectStore.setState({ project: { ...base, origin: 'blank' } })
  render(<PhotosButton />)
  expect(screen.queryByRole('button', { name: /^Photos/ })).toBeNull()
})
