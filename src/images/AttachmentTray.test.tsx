import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachmentTray } from './AttachmentTray'
import { useAttachments } from './attachments'

beforeEach(() => {
  useAttachments.setState(useAttachments.getInitialState(), true)
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thumb'), revokeObjectURL: vi.fn() })
})

it('renders nothing when there is nothing to show', () => {
  const { container } = render(<AttachmentTray />)
  expect(container).toBeEmptyDOMElement()
})

it('shows thumbnails that can be removed', async () => {
  useAttachments.getState().addPrepared({ blob: new Blob(['x']), mediaType: 'image/jpeg', width: 1, height: 1 }, 'photo.jpg')
  render(<AttachmentTray />)
  const thumb = screen.getByRole('img', { name: 'photo.jpg' })
  expect(thumb).toHaveClass('pc-msg-img')
  expect(thumb).toHaveAttribute('src', 'blob:thumb')
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo.jpg' }))
  expect(screen.queryByRole('img')).toBeNull()
})

it('shows the error as a callout, as text', () => {
  useAttachments.setState({ error: '<b>x</b>.txt is not an image. Attach a PNG, JPEG or WebP image.' })
  const { container } = render(<AttachmentTray />)
  expect(screen.getByRole('alert')).toHaveTextContent('<b>x</b>.txt is not an image.')
  expect(container.querySelector('b')).toBeNull()
})
