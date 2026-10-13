import { fireEvent, render, screen } from '@testing-library/react'
import { PhotoSlots } from './PhotoSlots'
import type { DraftPhoto } from './photoDraft'

const photo = (angle: DraftPhoto['angle']): DraftPhoto => ({ id: `id-${angle}`, angle, blob: new Blob(), mediaType: 'image/jpeg', url: 'blob:x', name: `${angle}.jpg` })

it('shows a slot per angle, filled ones with their photo and a remove button', () => {
  const onRemove = vi.fn()
  render(<PhotoSlots layout="angles" photos={[photo('front')]} onAdd={() => {}} onRemove={onRemove} />)
  expect(screen.getByRole('img', { name: 'Front photo' })).toHaveAttribute('src', 'blob:x')
  for (const label of ['Top', 'Side', 'Back', 'Bottom', 'Other angle']) expect(screen.getByLabelText(`Add ${label.toLowerCase()} photo`)).toBeInTheDocument()
  expect(screen.queryByLabelText('Add front photo')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Remove front photo' }))
  expect(onRemove).toHaveBeenCalledWith('id-front')
})

it('makes each empty slot one labelled file input, not a separate button', () => {
  render(<PhotoSlots layout="angles" photos={[]} onAdd={() => {}} onRemove={() => {}} />)
  const input = screen.getByLabelText('Add front photo')
  expect(input).toHaveAttribute('type', 'file')
  expect(input).toHaveAttribute('accept', 'image/*')
  expect(input.closest('label')).toHaveTextContent('Front')
  expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull()
})

it('passes chosen files with the slot’s angle, and shows the error', () => {
  const onAdd = vi.fn()
  render(<PhotoSlots layout="angles" photos={[]} onAdd={onAdd} onRemove={() => {}} error="Up to 5 photos per project. f.jpg was not added." />)
  const input = screen.getByLabelText('Add top photo') as HTMLInputElement
  const file = new File(['x'], 't.jpg', { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(onAdd).toHaveBeenCalledWith([file], 'top')
  expect(screen.getByRole('alert')).toHaveTextContent('f.jpg was not added.')
})

it('takes photos dropped on a slot with that slot’s angle', () => {
  const onAdd = vi.fn()
  render(<PhotoSlots layout="angles" photos={[]} onAdd={onAdd} onRemove={() => {}} />)
  const file = new File(['x'], 's.jpg', { type: 'image/jpeg' })
  fireEvent.drop(screen.getByLabelText('Add side photo').closest('label')!, { dataTransfer: { files: [file] } })
  expect(onAdd).toHaveBeenCalledWith([file], 'side')
})

it('groups an untagged photo under the other angle, which keeps an add slot', () => {
  render(<PhotoSlots layout="angles" photos={[photo('photo')]} onAdd={() => {}} onRemove={() => {}} />)
  expect(screen.getByRole('img', { name: 'Other angle photo' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove other angle photo' })).toBeInTheDocument()
  expect(screen.getByLabelText('Add front photo')).toBeInTheDocument()
  expect(screen.getByLabelText('Add other angle photo')).toBeInTheDocument()
})

it('shows one large slot in the one-photo layout', () => {
  render(<PhotoSlots layout="one" photos={[]} onAdd={() => {}} onRemove={() => {}} />)
  expect(screen.getByLabelText('Add photo')).toBeInTheDocument()
  expect(screen.queryByLabelText('Add top photo')).toBeNull()
})

it('shows the one photo with its remove button', () => {
  const onRemove = vi.fn()
  render(<PhotoSlots layout="one" photos={[photo('photo')]} onAdd={() => {}} onRemove={onRemove} />)
  expect(screen.getByRole('img', { name: 'Photo' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Add photo')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(onRemove).toHaveBeenCalledWith('id-photo')
})
