import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../db/db'
import * as lockApi from '../../security/lock'
import { useSettingsStore } from '../settingsStore'
import { SecuritySection } from './SecuritySection'

vi.mock('../../security/lock', () => ({
  isUnlocked: vi.fn(() => false),
  enableLock: vi.fn(async () => {}),
  unlock: vi.fn(async (p: string) => p === 'right passphrase'),
  lock: vi.fn(),
  disableLock: vi.fn(async () => {}),
  forgetLockedKeys: vi.fn(async () => {}),
}))

const setLockMode = (lockMode: boolean) => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, lockMode } })

beforeEach(() => {
  vi.clearAllMocks()
  setLockMode(false)
})

it('turns the lock on only with two matching passphrases of 8 or more characters', async () => {
  render(<SecuritySection />)
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'short' } })
  fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: 'short' } })
  fireEvent.click(screen.getByRole('button', { name: 'Turn on lock' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Use a passphrase of at least 8 characters')

  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'long enough one' } })
  fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: 'long enough two' } })
  fireEvent.click(screen.getByRole('button', { name: 'Turn on lock' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("The passphrases don't match")

  fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: 'long enough one' } })
  fireEvent.click(screen.getByRole('button', { name: 'Turn on lock' }))
  await waitFor(() => expect(lockApi.enableLock).toHaveBeenCalledWith('long enough one'))
})

it('unlocks with the right passphrase and explains a wrong one', async () => {
  setLockMode(true)
  render(<SecuritySection />)
  expect(screen.getByText('Your API keys are locked')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'wrong one' } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("That passphrase didn't unlock the keys. Check it and try again.")
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'right passphrase' } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  expect(await screen.findByText('Keys are unlocked until you close this tab')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Lock now' }))
  expect(lockApi.lock).toHaveBeenCalled()
  expect(screen.getByText('Your API keys are locked')).toBeInTheDocument()
})

it('forgets locked keys only after confirming', async () => {
  setLockMode(true)
  render(<SecuritySection />)
  fireEvent.click(screen.getByRole('button', { name: 'Forget locked keys' }))
  expect(lockApi.forgetLockedKeys).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete the locked keys' }))
  await waitFor(() => expect(lockApi.forgetLockedKeys).toHaveBeenCalled())
})

it('turns the lock off when unlocked', async () => {
  setLockMode(true)
  vi.mocked(lockApi.isUnlocked).mockReturnValue(true)
  render(<SecuritySection />)
  fireEvent.click(screen.getByRole('button', { name: 'Turn off lock' }))
  await waitFor(() => expect(lockApi.disableLock).toHaveBeenCalled())
})
