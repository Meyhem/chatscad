import { fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_SETTINGS, type ProviderProfile } from '../../db/db'
import { useProjectStore } from '../../history/projectStore'
import { useProvidersStore } from '../../settings/providersStore'
import { useSettingsStore } from '../../settings/settingsStore'
import { useAppStore } from '../../state/store'
import { useAgentStore, type ReviewCard } from '../agentStore'
import { NO_REVIEWER } from '../reviewer'
import { ChecksButton } from './ChecksButton'
import { ModeNote, ModeRow } from './ModeSwitch'

const profile = (vision: boolean): ProviderProfile => ({
  id: 'p1',
  name: 'OpenRouter',
  adapter: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  apiKey: 'k',
  defaultModel: 'gpt-5',
  cachedModels: [{ id: 'gpt-5' }, { id: 'claude-sonnet-5-5' }],
  capabilities: { streaming: true, vision, audio: false },
  priceTable: {},
  createdAt: 0,
  updatedAt: 0,
})

const project = (checks = [{ id: 'c1', kind: 'part' as const, text: 'A body' }, { id: 'c2', kind: 'part' as const, text: 'A lid' }]) => ({
  id: 'x', name: 'X', createdAt: 0, updatedAt: 0, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'blank' as const, checks,
})

const update = vi.fn(async () => {})
const setChecks = vi.fn(async () => {})
const setAgentMode = vi.fn(async () => {})

beforeEach(() => {
  update.mockClear()
  setChecks.mockClear()
  setAgentMode.mockClear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState({ project: project(), setChecks, setAgentMode })
  useAgentStore.setState({ cards: {} })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, update })
  useProvidersStore.setState({ profiles: [profile(true)], settings: { ...DEFAULT_SETTINGS, activeProfileId: 'p1', activeModel: 'gpt-5' } })
})

describe('Checks button', () => {
  it('counts the checks, then how many passed the latest review', () => {
    const { rerender } = render(<ChecksButton />)
    expect(screen.getByRole('button', { name: 'Checks · 2' })).toBeInTheDocument()
    const card = {
      kind: 'review', id: 'r', noteId: 'n', round: 1, status: 'ready', model: 'gpt-5', versionLabel: null, frames: [], legend: [], coloured: true,
      review: { summary: '', issues: [], newChecks: [], verdicts: [{ checkId: 'c1', status: 'pass', evidence: '' }, { checkId: 'c2', status: 'fail', evidence: '' }] },
      selected: [], limitReached: false, suggestionsAdded: false, usage: null, error: null,
    } satisfies ReviewCard
    useAgentStore.setState({ cards: { r: card } })
    rerender(<ChecksButton />)
    expect(screen.getByRole('button', { name: 'Checks · 1 of 2 pass' })).toBeInTheDocument()
  })

  it('says when there are none', () => {
    useProjectStore.setState({ project: project([]) })
    render(<ChecksButton />)
    expect(screen.getByRole('button', { name: 'No checks' })).toBeInTheDocument()
  })

  it('edits the checks and saves them to the project', () => {
    render(<ChecksButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Checks · 2' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Check 2' }), { target: { value: 'A lid with a finger notch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(setChecks).toHaveBeenCalledWith([
      { id: 'c1', kind: 'part', text: 'A body' },
      { id: 'c2', kind: 'part', text: 'A lid with a finger notch' },
    ])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Mode switch', () => {
  it('starts in Agent, says what a run does, and saves Edit to the project', () => {
    render(<ModeRow />)
    expect(screen.getByRole('radio', { name: 'Agent' })).toBeChecked()
    expect(screen.getByText('Reviewer gpt-5 · 3 rounds max')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Edit' }))
    expect(setAgentMode).toHaveBeenCalledWith('edit')
  })

  it('in Edit says there is no review and has no agent settings', () => {
    useProjectStore.setState({ project: { ...project(), agentMode: 'edit' } })
    render(<ModeRow />)
    expect(screen.getByRole('radio', { name: 'Edit' })).toBeChecked()
    expect(screen.getByText('One builder turn · no review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agent settings' })).toBeNull()
  })

  it('without a model that takes images, Agent is disabled and a note says how to fix it', () => {
    useProvidersStore.setState({ profiles: [profile(false)] })
    render(
      <>
        <ModeRow />
        <ModeNote />
      </>,
    )
    expect(screen.getByRole('radio', { name: 'Edit' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Agent' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Agent' })).toHaveAttribute('title', NO_REVIEWER)
    expect(screen.getByText('Agent mode needs a model that takes images. Turn on Vision for a provider.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }))
    expect(useAppStore.getState().view).toBe('settings')
  })

  it('has no note while a model can review', () => {
    render(<ModeNote />)
    expect(screen.queryByText(/needs a model that takes images/)).toBeNull()
  })

  it('saves the reviewer model, rounds, fixes and plan approval', () => {
    render(<ModeRow />)
    fireEvent.click(screen.getByRole('button', { name: 'Agent settings' }))
    const select = screen.getByRole('combobox', { name: 'Reviewer model' })
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Same as the builder', 'gpt-5 · OpenRouter', 'claude-sonnet-5-5 · OpenRouter'])
    fireEvent.change(select, { target: { value: 'p1\nclaude-sonnet-5-5' } })
    expect(update).toHaveBeenCalledWith({ reviewProfileId: 'p1', reviewModel: 'claude-sonnet-5-5' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Rounds' }), { target: { value: '2' } })
    expect(update).toHaveBeenCalledWith({ reviewRounds: 2 })
    fireEvent.click(screen.getByRole('radio', { name: 'Fix until every check passes' }))
    expect(update).toHaveBeenCalledWith({ reviewMode: 'auto' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Approve the checks before the first build' }))
    expect(update).toHaveBeenCalledWith({ reviewApprovePlan: false })
  })
})
