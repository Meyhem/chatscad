import { render } from '@testing-library/react'
import { usePrefs } from '../settings/prefsStore'
import { GlobalOverlays } from './GlobalOverlays'

it('loads the M4 prefs once when mounted', () => {
  const load = vi.fn(async () => {})
  usePrefs.setState({ load })
  const { rerender } = render(<GlobalOverlays />)
  rerender(<GlobalOverlays />)
  expect(load).toHaveBeenCalledTimes(1)
})
