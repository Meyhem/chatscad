import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_SETTINGS } from '../db/db'
import { newProfile } from '../db/profiles'
import { useProvidersStore } from '../settings/providersStore'
import { resetDb } from '../test/db'
import { useChatStore } from './chatStore'
import { Composer } from './Composer'
import { sendPrompt, stopTurn } from './sendPrompt'
import { usePrefs } from '../settings/prefsStore'
import { startVariants } from '../variants/startVariants'
import { useAgentStore } from '../agent/agentStore'
import { useProjectStore } from '../history/projectStore'

vi.mock('./sendPrompt', () => ({ sendPrompt: vi.fn(async () => {}), stopTurn: vi.fn() }))
vi.mock('../variants/startVariants', () => ({ startVariants: vi.fn(() => true) }))

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

it('with 3 variants per prompt, Enter starts the variants instead of a single reply and clears the draft', async () => {
  usePrefs.setState({ variantCount: 3 })
  try {
    render(<Composer />)
    await userEvent.type(screen.getByLabelText('Prompt'), 'A hook{Enter}')
    expect(startVariants).toHaveBeenCalledWith('A hook')
    expect(sendPrompt).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Prompt')).toHaveValue('')
  } finally {
    usePrefs.setState({ variantCount: 1 })
  }
})

it('shows the mic where the browser can dictate, and sends the dictated transcript with the message', async () => {
  const { useVoiceStore } = await import('../voice/voiceStore')
  class FakeRecognition {
    lang = ''
    continuous = false
    interimResults = false
    onresult = null
    onerror = null
    onend: (() => void) | null = null
    start = vi.fn()
    stop = vi.fn(() => this.onend?.())
    abort = vi.fn()
  }
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
  try {
    useProvidersStore.setState({ settings: { ...DEFAULT_SETTINGS, activeProfileId: profile.id, activeModel: 'm1' } })
    render(<Composer />)
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument()
    useVoiceStore.getState().setTranscript('a box with a lid')
    await userEvent.type(screen.getByLabelText('Prompt'), 'a box with a lid{Enter}')
    expect(sendPrompt).toHaveBeenCalledWith('a box with a lid', { audioTranscript: 'a box with a lid' })
    expect(useVoiceStore.getState().transcript).toBeNull()
  } finally {
    Reflect.deleteProperty(window, 'webkitSpeechRecognition')
  }
})

it('hides the mic without speech recognition or a provider that can transcribe', () => {
  render(<Composer />)
  expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
})

describe('M5: attachments and the picked part', () => {
  beforeEach(async () => {
    const { useAttachments } = await import('../images/attachments')
    const { useRefineStore } = await import('../refine/refineStore')
    useAttachments.setState({ items: [], error: null })
    useRefineStore.setState({ pick: null })
    usePrefs.setState({ variantCount: 1 })
    vi.mocked(startVariants).mockClear()
  })

  it('has the attach button, disabled with the reason when the profile cannot take images', () => {
    useProvidersStore.setState({ settings: { ...DEFAULT_SETTINGS, activeProfileId: profile.id, activeModel: 'm1' } })
    render(<Composer />)
    const attach = screen.getByRole('button', { name: 'Attach image or sketch' })
    expect(attach).toBeDisabled()
    expect(attach.getAttribute('title')).toMatch(/image/i)
  })

  it('shows the picked part as a chip in the composer', async () => {
    const { useRefineStore } = await import('../refine/refineStore')
    const { partPickFixture } = await import('../test/picks')
    useRefineStore.setState({ pick: partPickFixture() })
    render(<Composer />)
    expect(screen.getByText('Only this part will change')).toBeInTheDocument()
  })

  it('sends one scoped turn instead of variants while a part is picked', async () => {
    const { useRefineStore } = await import('../refine/refineStore')
    const { partPickFixture } = await import('../test/picks')
    useProvidersStore.setState({ settings: { ...DEFAULT_SETTINGS, activeProfileId: profile.id, activeModel: 'm1' } })
    useRefineStore.setState({ pick: partPickFixture() })
    usePrefs.setState({ variantCount: 3 })
    render(<Composer />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Wider{Enter}')
    expect(startVariants).not.toHaveBeenCalled()
    expect(sendPrompt).toHaveBeenCalledWith('Wider')
  })
})

describe('Edit and Agent modes', () => {
  const vision = { ...profile, capabilities: { ...profile.capabilities, vision: true } }
  const project = { id: 'x', name: 'X', createdAt: 0, updatedAt: 0, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'blank' as const }
  const submit = vi.fn(async () => {})

  beforeEach(() => {
    submit.mockClear()
    useAgentStore.setState({ submit })
    useProvidersStore.setState({ profiles: [vision], settings: { ...DEFAULT_SETTINGS, activeProfileId: profile.id, activeModel: 'm1' } })
    useProjectStore.setState({ project })
    usePrefs.setState({ variantCount: 1 })
  })

  it('in Agent the action reads Run agent and sends the request in Agent mode', async () => {
    render(<Composer />)
    expect(screen.getByRole('radio', { name: 'Agent' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    await userEvent.type(screen.getByLabelText('Prompt'), 'A hook')
    await userEvent.click(screen.getByRole('button', { name: 'Run agent' }))
    expect(submit).toHaveBeenCalledWith('A hook', undefined, { mode: 'agent' })
  })

  it('in Agent there are no variants, even when 3 are chosen', async () => {
    usePrefs.setState({ variantCount: 3 })
    render(<Composer />)
    expect(screen.queryByRole('button', { name: 'Variants per prompt' })).toBeNull()
    await userEvent.type(screen.getByLabelText('Prompt'), 'A hook{Enter}')
    expect(startVariants).not.toHaveBeenCalled()
    expect(submit).toHaveBeenCalledWith('A hook', undefined, { mode: 'agent' })
  })

  it('in Edit the action reads Send and the variants are offered', async () => {
    useProjectStore.setState({ project: { ...project, agentMode: 'edit' } })
    render(<Composer />)
    expect(screen.getByRole('button', { name: 'Variants per prompt' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Prompt'), 'Taller')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(submit).toHaveBeenCalledWith('Taller', undefined, { mode: 'edit' })
  })

  it('keeps the model options inside the input box', () => {
    render(<Composer />)
    expect(screen.getByRole('button', { name: 'Model: m1' }).closest('.pc-composer')).not.toBeNull()
  })
})
