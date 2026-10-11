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
