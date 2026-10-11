import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LowQualityPreviewSwitch } from './LowQualityPreviewSwitch'
import { usePrefs } from './prefsStore'

beforeEach(() => usePrefs.setState(usePrefs.getInitialState(), true))

it('turns the quick preview pass on and off', async () => {
  const update = vi.fn(async () => {})
  usePrefs.setState({ update })
  render(<LowQualityPreviewSwitch />)
  const toggle = screen.getByRole('checkbox', { name: 'Quick preview before each render' })
  expect(toggle).not.toBeChecked()
  await userEvent.click(toggle)
  expect(update).toHaveBeenCalledWith({ lowQualityPreview: true })
  expect(screen.getByText(/Renders once with \$fn = 12/)).toBeInTheDocument()
})

import { TranscriptionModelField } from './TranscriptionModelField'

it('edits the transcription model and saves it on blur', async () => {
  const update = vi.fn(async () => {})
  usePrefs.setState({ update, transcriptionModel: 'whisper-1' })
  render(<TranscriptionModelField />)
  const field = screen.getByLabelText('Transcription model')
  expect(field).toHaveValue('whisper-1')
  await userEvent.clear(field)
  await userEvent.type(field, 'gpt-4o-transcribe')
  await userEvent.tab()
  expect(update).toHaveBeenCalledWith({ transcriptionModel: 'gpt-4o-transcribe' })
})
