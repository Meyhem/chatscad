import { fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_SETTINGS, type ProviderProfile } from '../../db/db'
import { useProjectStore } from '../../history/projectStore'
import { useProvidersStore } from '../../settings/providersStore'
import { useSettingsStore } from '../../settings/settingsStore'
import { useAppStore } from '../../state/store'
import { useAgentStore, type ReviewCard } from '../agentStore'
import { NO_REVIEWER } from '../reviewer'
import { ChecksButton } from './ChecksButton'
import { ReviewButton } from './ReviewButton'

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

beforeEach(() => {
  update.mockClear()
  setChecks.mockClear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState({ project: project(), setChecks })
  useAgentStore.setState({ cards: {}, reviewNext: false })
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

describe('Review button', () => {
  it('is disabled with the reason when no model takes images', () => {
    useProvidersStore.setState({ profiles: [profile(false)] })
    render(<ReviewButton />)
    const button = screen.getByRole('button', { name: `Review. ${NO_REVIEWER}` })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', NO_REVIEWER)
  })

  it('is on for a new model, off for an edit unless switched on', () => {
    const { rerender } = render(<ReviewButton />)
    expect(screen.getByRole('button', { name: 'Review: on for the next request, by gpt-5' })).toBeInTheDocument()
    useAppStore.setState({ code: 'cube(1);' })
    rerender(<ReviewButton />)
    expect(screen.getByRole('button', { name: 'Review: off' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review: off' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Review this request' }))
    expect(useAgentStore.getState().reviewNext).toBe(true)
    expect(screen.getByRole('button', { name: /^Review: on/ })).toBeInTheDocument()
  })

  it('saves the reviewer model, rounds and approval mode', () => {
    render(<ReviewButton />)
    fireEvent.click(screen.getByRole('button', { name: /^Review: on/ }))
    const select = screen.getByRole('combobox', { name: 'Reviewer model' })
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Same as the builder', 'gpt-5 · OpenRouter', 'claude-sonnet-5-5 · OpenRouter'])
    fireEvent.change(select, { target: { value: 'p1\nclaude-sonnet-5-5' } })
    expect(update).toHaveBeenCalledWith({ reviewProfileId: 'p1', reviewModel: 'claude-sonnet-5-5' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Rounds' }), { target: { value: '2' } })
    expect(update).toHaveBeenCalledWith({ reviewRounds: 2 })
    fireEvent.click(screen.getByRole('radio', { name: 'Fix until every check passes' }))
    expect(update).toHaveBeenCalledWith({ reviewMode: 'auto' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Review new models on their own' }))
    expect(update).toHaveBeenCalledWith({ reviewNewModels: false })
  })
})
