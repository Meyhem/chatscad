import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_SETTINGS } from '../db/db'
import { newProfile } from '../db/profiles'
import { useProvidersStore } from '../settings/providersStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/db'
import { ChatPanel, SUGGESTIONS } from './ChatPanel'
import { useChatStore, type ChatMessage } from './chatStore'
import { goBack, stopTurn } from './sendPrompt'

vi.mock('./sendPrompt', () => ({ sendPrompt: vi.fn(async () => {}), stopTurn: vi.fn(), goBack: vi.fn() }))

const profile = newProfile({ name: 'P', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', defaultModel: 'claude-sonnet-5-5' })
const msg = (over: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'text'>): ChatMessage => ({
  turnLabel: null,
  model: null,
  usage: null,
  status: 'done',
  ...over,
})

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useChatStore.setState(useChatStore.getInitialState(), true)
  useProvidersStore.setState({ ...useProvidersStore.getInitialState(), loaded: true, profiles: [profile], settings: DEFAULT_SETTINGS }, true)
})

it('is the Chat region with a pane head', () => {
  render(<ChatPanel />)
  expect(screen.getByRole('region', { name: 'Chat' })).toHaveTextContent('Chat')
  expect(screen.queryByTestId('project-cost')).toBeNull()
})

it('on first run explains how to connect a model; its buttons open settings or the editor', async () => {
  useProvidersStore.setState({ profiles: [] })
  render(<ChatPanel />)
  expect(screen.getByText('Connect an AI model to start')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add a provider' })).toHaveClass('is-primary')
  await userEvent.click(screen.getByRole('button', { name: 'Edit code by hand' }))
  expect(useAppStore.getState().reveal?.line).toBe(1)
  await userEvent.click(screen.getByRole('button', { name: 'Add a provider' }))
  expect(useAppStore.getState().view).toBe('settings')
})

it('waits for the profiles to load before showing the first-run callout', () => {
  useProvidersStore.setState({ profiles: [], loaded: false })
  render(<ChatPanel />)
  expect(screen.queryByText('Connect an AI model to start')).toBeNull()
})

it('offers suggestions on an empty chat that fill the prompt box', async () => {
  render(<ChatPanel />)
  expect(screen.getByText('Try asking for')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: SUGGESTIONS[1] }))
  expect(screen.getByLabelText('Prompt')).toHaveValue('A box for 18650 cells with a sliding lid')
})

it('shows the messages and the cost of this chat, without suggestions', () => {
  useChatStore.setState({
    messages: [
      msg({ id: 'u', role: 'user', text: 'A holder' }),
      msg({ id: 'a', role: 'assistant', text: 'Made it.', turnLabel: 'v1', usage: { inputTokens: 1, outputTokens: 1, cost: 0.011 } }),
      msg({ id: 'b', role: 'assistant', text: 'Wider.', turnLabel: 'v2', usage: { inputTokens: 1, outputTokens: 1, cost: 0.015 } }),
    ],
  })
  render(<ChatPanel />)
  expect(screen.queryByText('Try asking for')).toBeNull()
  expect(screen.getAllByTestId('chat-reply')).toHaveLength(2)
  expect(screen.getByTestId('project-cost')).toHaveTextContent('$0.026 this project')
  expect(screen.getByTestId('project-cost')).toHaveClass('pc-mono')
})

it('during auto-fix shows the busy pill, what is happening, Stop auto-fix and Back to vN', async () => {
  useChatStore.setState({
    busy: true,
    fixing: { attempt: 1, of: 2, model: 'claude-sonnet-5-5' },
    backTo: { label: 'v3', code: 'cube(1);' },
    messages: [
      msg({ id: 'a', role: 'assistant', text: 'Changed the bores.', compileStatus: 'error', error: { title: 'Line 16: Parser error: syntax error', body: 'x' } }),
    ],
  })
  render(<ChatPanel />)
  const row = screen.getByTestId('autofix')
  expect(row.querySelector('.pc-status.is-busy')).toHaveTextContent('Auto-fix 1 of 2')
  expect(row.querySelector('.pc-status svg')).not.toBeNull()
  expect(row).toHaveTextContent('Sending the error back to claude-sonnet-5-5…')
  await userEvent.click(screen.getByRole('button', { name: 'Stop auto-fix' }))
  expect(stopTurn).toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Back to v3' }))
  expect(goBack).toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('keeps "Back to" after a turn that ended with code that does not compile', () => {
  useChatStore.setState({
    backTo: { label: null, code: 'cube(1);' },
    messages: [msg({ id: 'a', role: 'assistant', text: 'x', compileStatus: 'error' })],
  })
  render(<ChatPanel />)
  expect(screen.getByRole('button', { name: 'Back to previous code' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Stop auto-fix' })).toBeNull()
})

it('hides "Back to" once the last reply compiled', () => {
  useChatStore.setState({
    backTo: { label: 'v1', code: 'cube(1);' },
    messages: [msg({ id: 'a', role: 'assistant', text: 'x', compileStatus: 'ok' })],
  })
  render(<ChatPanel />)
  expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull()
})

it('keeps "Back to" after Stop auto-fix, while the failing AI code is still in the editor', () => {
  useAppStore.setState({ status: 'error', codeSource: 'ai' })
  useChatStore.setState({
    backTo: { label: 'v1', code: 'cube(1);' },
    messages: [
      msg({ id: 'a', role: 'assistant', text: 'x', compileStatus: 'error' }),
      msg({ id: 'b', role: 'assistant', text: '' }),
      msg({ id: 'c', role: 'note', text: 'Stopped.' }),
    ],
  })
  render(<ChatPanel />)
  expect(screen.getByRole('button', { name: 'Back to v1' })).toBeInTheDocument()
})
