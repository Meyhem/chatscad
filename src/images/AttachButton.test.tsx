import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachButton } from './AttachButton'
import { NO_VISION_EXPLANATION, useAttachments } from './attachments'

beforeEach(() => useAttachments.setState(useAttachments.getInitialState(), true))

it('is disabled with the reason when the profile has no vision', () => {
  render(<AttachButton vision={false} onSketch={() => {}} />)
  const button = screen.getByRole('button', { name: 'Attach image or sketch' })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('title', NO_VISION_EXPLANATION)
})

it('offers an image from the device or a sketch', async () => {
  const onSketch = vi.fn()
  render(<AttachButton vision onSketch={onSketch} />)
  await userEvent.click(screen.getByRole('button', { name: 'Attach image or sketch' }))
  expect(screen.getByRole('menuitem', { name: 'Image from device' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Sketch' }))
  expect(onSketch).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).toBeNull()
})

it('hands chosen files to the attachment list', () => {
  const addFiles = vi.fn(async () => {})
  useAttachments.setState({ addFiles })
  render(<AttachButton vision onSketch={() => {}} />)
  const input = screen.getByLabelText('Image file') as HTMLInputElement
  const photo = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [photo] } })
  expect(addFiles).toHaveBeenCalledWith([photo])
  expect(input).toHaveAttribute('accept', 'image/*')
})
