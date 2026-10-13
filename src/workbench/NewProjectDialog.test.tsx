import { fireEvent, render, screen } from '@testing-library/react'
import { useAppStore } from '../state/store'
import { NewProjectDialog } from './NewProjectDialog'

beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
})

function setup(props: Partial<Parameters<typeof NewProjectDialog>[0]> = {}) {
  const onCreate = vi.fn()
  const onClose = vi.fn()
  const view = render(<NewProjectDialog onCreate={onCreate} onClose={onClose} vision {...props} />)
  return { onCreate, onClose, ...view }
}

it('asks for a name and the libraries, with BOSL2 recommended and on', () => {
  setup()
  expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument()
  expect(screen.getByLabelText('Name')).toHaveValue('Untitled project')
  expect(screen.getByRole('checkbox', { name: 'Use BOSL2 in this project' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Use MCAD in this project' })).not.toBeChecked()
  expect(screen.getByText('Recommended')).toBeInTheDocument()
  expect(screen.getByText(/The AI may use BOSL2\./)).toBeInTheDocument()
})

it('explains what each library contains on request', () => {
  setup()
  const [bosl] = screen.getAllByRole('button', { name: 'What is inside' })
  expect(bosl).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Threads')).toBeNull()
  fireEvent.click(bosl)
  expect(bosl).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Threads')).toBeInTheDocument()
  expect(screen.getByText('include <BOSL2/std.scad>')).toBeInTheDocument()
})

it('updates the summary as libraries are switched', () => {
  setup()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use MCAD in this project' }))
  expect(screen.getByText(/The AI may use BOSL2 and MCAD\./)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use BOSL2 in this project' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use MCAD in this project' }))
  expect(screen.getByText(/No libraries/)).toBeInTheDocument()
})

it('creates the project with the trimmed name and the chosen libraries', () => {
  const { onCreate } = setup()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Hose filter ' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use MCAD in this project' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  expect(onCreate).toHaveBeenCalledWith({ name: 'Hose filter', enabledLibraries: ['BOSL2', 'MCAD'] })
})

it('needs a name, and cancels without creating', () => {
  const { onCreate, onClose } = setup()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' ' } })
  expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
  expect(onCreate).not.toHaveBeenCalled()
})

it('offers Photos only when the active model takes images', () => {
  const { onClose } = setup({ vision: false })
  const photos = screen.getByRole('radio', { name: 'Photos' })
  expect(photos).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(photos)
  expect(photos).toHaveAttribute('aria-checked', 'false')
  expect(screen.queryByLabelText('Describe it')).toBeNull()
  expect(screen.getByText(/Images need a model with vision/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open AI providers' }))
  expect(useAppStore.getState().view).toBe('settings')
  expect(onClose).toHaveBeenCalled()
})

it('switches between one photo and several angles, and collapses the libraries to one line', () => {
  setup()
  expect(screen.getByRole('radio', { name: 'Blank' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Photos' }))
  expect(screen.getByRole('radio', { name: 'Photos' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Several angles' })).toBeChecked()
  expect(screen.getByLabelText('Add front photo')).toBeInTheDocument()
  expect(screen.getByText(/Fill the angles you have\. One is enough to start\./)).toBeInTheDocument()
  expect(screen.getByText('BOSL2')).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Use BOSL2 in this project' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Change' }))
  expect(screen.getByRole('checkbox', { name: 'Use BOSL2 in this project' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'One photo' }))
  expect(screen.getByLabelText('Add photo')).toBeInTheDocument()
  expect(screen.getByText(/Put a coin, card or ruler next to it/)).toBeInTheDocument()
  expect(screen.getByText('The agent plans checks from your description and photos, then builds v1.')).toBeInTheDocument()
})

it('creates a photo project with the photos, the description and the scale', async () => {
  const prepare = async (b: Blob) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })
  const { onCreate } = setup({ prepare })
  fireEvent.click(screen.getByRole('radio', { name: 'Photos' }))
  const file = new File(['x'], 'front.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('Add front photo'), { target: { files: [file] } })
  await screen.findByRole('img', { name: 'Front photo' })
  fireEvent.change(screen.getByLabelText('Describe it'), { target: { value: 'A bracket, about 50 mm tall' } })
  fireEvent.change(screen.getByLabelText('Scale'), { target: { value: 'description' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create and build' }))
  expect(onCreate).toHaveBeenCalledWith({
    name: 'Untitled project',
    enabledLibraries: ['BOSL2'],
    photos: { photos: [expect.objectContaining({ angle: 'front', name: 'front.jpg' })], brief: 'A bracket, about 50 mm tall', scale: 'description' },
  })
})

it('needs at least one photo and a description to create a photo project', () => {
  setup()
  fireEvent.click(screen.getByRole('radio', { name: 'Photos' }))
  expect(screen.getByRole('button', { name: 'Create and build' })).toBeDisabled()
})

it('releases the thumbnails when it closes', async () => {
  const prepare = async (b: Blob) => ({ blob: b, mediaType: 'image/jpeg' as const, width: 1, height: 1 })
  const { unmount } = setup({ prepare })
  fireEvent.click(screen.getByRole('radio', { name: 'Photos' }))
  fireEvent.change(screen.getByLabelText('Add front photo'), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('img', { name: 'Front photo' })
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
})

it('moves between the start options with the arrow keys, skipping Photos without vision', () => {
  const { unmount } = setup({ vision: false })
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Blank' }), { key: 'ArrowRight' })
  expect(screen.getByRole('radio', { name: 'Blank' })).toBeChecked()
  unmount()
  setup()
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Blank' }), { key: 'ArrowRight' })
  expect(screen.getByRole('radio', { name: 'Photos' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Photos' })).toHaveFocus()
})
