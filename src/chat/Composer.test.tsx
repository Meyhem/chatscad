import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_SETTINGS } from '../db/db'
import { newProfile } from '../db/profiles'
import { useProvidersStore } from '../settings/providersStore'
import { resetDb } from '../test/db'
import { useChatStore } from './chatStore'
import { Composer } from './Composer'
import { sendPrompt, stopTurn } from './sendPrompt'

vi.mock('./sendPrompt', () => ({ sendPrompt: vi.fn(async () => {}), stopTurn: vi.fn() }))

const profile = newProfile({ name: 'P', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', defaultModel: 'm1' })

beforeEach(async () => {
  await resetDb()
  vi.mocked(sendPrompt).mockClear()
  useChatStore.setState(useChatStore.getInitialState(), true)
  useProvidersStore.setState({ ...useProvidersStore.getInitialState(), loaded: true, profiles: [profile], settings: DEFAULT_SETTINGS }, true)
})

it('disables Send and the model picker until a provider exists (first run)', () => {
  useProvidersStore.setState({ profiles: [] })
  render(<Composer />)
  expect(screen.getByRole('button', { name: 'No model' })).toBeDisabled()
  const send = screen.getByRole('button', { name: 'Send' })
  expect(send).toBeDisabled()
  expect(send).toHaveAttribute('title', 'Add a provider first')
})

it('Send is the primary action and is disabled while the prompt is empty', () => {
  render(<Composer />)
  const send = screen.getByRole('button', { name: 'Send' })
  expect(send).toHaveClass('pc-btn', 'is-primary')
  expect(send).toBeDisabled()
})

it('sends with Enter and keeps Shift+Enter for new lines', async () => {
  render(<Composer />)
  const box = screen.getByLabelText('Prompt')
  await userEvent.type(box, 'A knob{Shift>}{Enter}{/Shift}40 mm across')
  expect(box).toHaveValue('A knob\n40 mm across')
  await userEvent.type(box, '{Enter}')
  expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('A knob\n40 mm across')
})

it('sends with the Send button', async () => {
  render(<Composer />)
  await userEvent.type(screen.getByLabelText('Prompt'), 'A hook')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(sendPrompt).toHaveBeenCalledWith('A hook')
})

it('shows the draft that a suggestion filled in', () => {
  useChatStore.setState({ draft: 'A wall hook for a 30 mm broom handle' })
  render(<Composer />)
  expect(screen.getByLabelText('Prompt')).toHaveValue('A wall hook for a 30 mm broom handle')
})

it('offers Stop instead of Send while a turn runs', async () => {
  useChatStore.setState({ busy: true })
  render(<Composer />)
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
  expect(stopTurn).toHaveBeenCalled()
})
