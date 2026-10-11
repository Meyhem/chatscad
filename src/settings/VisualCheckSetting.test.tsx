import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getVisualCheck, setVisualCheck } from '../db/visualCheck'
import { VisualCheckSetting } from './VisualCheckSetting'

vi.mock('../db/visualCheck', () => ({ getVisualCheck: vi.fn(async () => false), setVisualCheck: vi.fn(async () => {}) }))

it('loads the setting, off by default, and saves changes', async () => {
  render(<VisualCheckSetting />)
  const toggle = screen.getByRole('checkbox', { name: 'Visual check after each AI change' })
  await waitFor(() => expect(getVisualCheck).toHaveBeenCalled())
  expect(toggle).not.toBeChecked()
  await userEvent.click(toggle)
  expect(toggle).toBeChecked()
  expect(setVisualCheck).toHaveBeenCalledWith(true)
  expect(screen.getByText(/Uses extra tokens\./)).toBeInTheDocument()
})
