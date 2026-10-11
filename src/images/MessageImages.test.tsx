import { render, screen } from '@testing-library/react'
import { MessageImages } from './MessageImages'

const store = new Map([
  ['a', new Blob(['a'], { type: 'image/jpeg' })],
  ['b', new Blob(['b'], { type: 'image/png' })],
])
const load = async (id: string) => store.get(id) ?? null

beforeEach(() => {
  let n = 0
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() })
})

it('shows stored images as thumbnails above the message, skipping missing ones', async () => {
  render(<MessageImages ids={['a', 'gone', 'b']} load={load} />)
  const thumbs = await screen.findAllByRole('img')
  expect(thumbs.map((t) => t.getAttribute('alt'))).toEqual(['Attached image 1 of 2', 'Attached image 2 of 2'])
  expect(thumbs[0]).toHaveClass('pc-msg-img')
})

it('revokes its object URLs on unmount', async () => {
  const { unmount } = render(<MessageImages ids={['a']} load={load} />)
  await screen.findByRole('img')
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
})

it('renders nothing without images', () => {
  const { container } = render(<MessageImages ids={[]} load={load} />)
  expect(container).toBeEmptyDOMElement()
})
