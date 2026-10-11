import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DictationCaption } from './DictationCaption'
import { MicButton } from './MicButton'

it('is a Dictate button that turns into Stop dictation while listening', async () => {
  const onToggle = vi.fn()
  const { rerender } = render(<MicButton listening={false} busy={false} onToggle={onToggle} />)
  await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
  expect(onToggle).toHaveBeenCalledOnce()

  rerender(<MicButton listening busy={false} onToggle={onToggle} />)
  const stop = screen.getByRole('button', { name: 'Stop dictation' })
  expect(stop).toHaveAttribute('aria-pressed', 'true')
  expect(stop).toHaveClass('bg-accent-soft', 'text-accent')

  rerender(<MicButton listening={false} busy onToggle={onToggle} />)
  expect(screen.getByRole('button', { name: 'Dictate' })).toBeDisabled()
})

it('captions each phase in the screen wording', () => {
  const { rerender, container } = render(<DictationCaption state={{ phase: 'idle', message: null }} mode="speech" />)
  expect(container).toBeEmptyDOMElement()

  rerender(<DictationCaption state={{ phase: 'listening', message: null }} mode="speech" />)
  expect(screen.getByRole('status')).toHaveTextContent(
    'Listening… tap the mic to stop. Chrome sends speech to Google for recognition.',
  )
  rerender(<DictationCaption state={{ phase: 'listening', message: null }} mode="record" />)
  expect(screen.getByRole('status')).toHaveTextContent('Recording… tap the mic to stop. The audio goes to your provider to be transcribed.')
  rerender(<DictationCaption state={{ phase: 'transcribing', message: null }} mode="record" />)
  expect(screen.getByRole('status')).toHaveTextContent('Transcribing…')
  rerender(<DictationCaption state={{ phase: 'error', message: 'No speech was heard. Tap the mic and try again.' }} mode="speech" />)
  expect(screen.getByRole('alert')).toHaveTextContent('No speech was heard. Tap the mic and try again.')
  expect(screen.getByRole('alert')).toHaveClass('pc-caption', 'text-error')
})
