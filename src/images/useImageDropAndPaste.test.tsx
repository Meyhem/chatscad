import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { NO_VISION_EXPLANATION, useAttachments } from './attachments'
import { useImageDropAndPaste } from './useImageDropAndPaste'

function Target({ vision }: { vision: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useImageDropAndPaste(ref, vision)
  return <div ref={ref} data-testid="target" />
}

const image = new File(['x'], 'pasted.png', { type: 'image/png' })
const text = new File(['x'], 'notes.txt', { type: 'text/plain' })
const addFiles = vi.fn(async () => {})

beforeEach(() => {
  useAttachments.setState({ ...useAttachments.getInitialState(), addFiles }, true)
  addFiles.mockClear()
})

it('attaches pasted images', () => {
  const { getByTestId } = render(<Target vision />)
  fireEvent.paste(getByTestId('target'), { clipboardData: { files: [image, text], types: ['Files'] } })
  expect(addFiles).toHaveBeenCalledWith([image])
})

it('attaches dropped images', () => {
  const { getByTestId } = render(<Target vision />)
  fireEvent.drop(getByTestId('target'), { dataTransfer: { files: [image], types: ['Files'] } })
  expect(addFiles).toHaveBeenCalledWith([image])
})

it('leaves text pastes alone', () => {
  const { getByTestId } = render(<Target vision />)
  fireEvent.paste(getByTestId('target'), { clipboardData: { files: [], types: ['text/plain'] } })
  expect(addFiles).not.toHaveBeenCalled()
})

it('explains instead of attaching when the profile has no vision', () => {
  const { getByTestId } = render(<Target vision={false} />)
  fireEvent.drop(getByTestId('target'), { dataTransfer: { files: [image], types: ['Files'] } })
  expect(addFiles).not.toHaveBeenCalled()
  expect(useAttachments.getState().error).toBe(NO_VISION_EXPLANATION)
})
