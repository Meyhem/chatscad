import { fireEvent, render, screen, within } from '@testing-library/react'
import { useProjectStore } from '../../history/projectStore'
import { useAgentStore, type PlanCard, type ReviewCard } from '../agentStore'
import type { Check } from '../checks'
import { AgentCardView } from './AgentCardView'

const CHECKS: Check[] = [
  { id: 'c1', kind: 'part', text: 'A body' },
  { id: 'c2', kind: 'part', text: 'Rails on both long sides' },
  { id: 'c3', kind: 'print', text: 'Prints without supports' },
]

const plan: PlanCard = {
  kind: 'plan',
  id: 'p',
  noteId: 'n1',
  request: 'A holder',
  then: 'build',
  status: 'ready',
  checks: CHECKS,
  parts: ['body', 'lid_rail'],
  model: 'builder',
  usage: { inputTokens: 500, outputTokens: 340, cost: 0.004 },
  error: null,
}

const review: ReviewCard = {
  kind: 'review',
  id: 'r',
  noteId: 'n2',
  round: 1,
  status: 'ready',
  model: 'seer',
  versionLabel: 'v1',
  frames: [
    { view: 'iso', url: 'blob:iso' },
    { view: 'right', url: 'blob:right' },
  ],
  legend: [
    { tag: 1, label: 'body', lines: 'line 1', colour: 'orange', token: 'part-1' },
    { tag: 2, label: 'lid_rail', lines: 'lines 3–4', colour: 'sky blue', token: 'part-2' },
  ],
  coloured: true,
  review: {
    summary: 'One rail only.',
    verdicts: [
      { checkId: 'c1', status: 'pass', evidence: 'Body in every view.' },
      { checkId: 'c2', status: 'fail', evidence: 'Right view: one rail.' },
      { checkId: 'c3', status: 'unclear', evidence: 'Overhang 1.6 mm.' },
    ],
    issues: [
      { id: 'i1', severity: 'high', part: 'lid_rail', checkId: 'c2', change: 'Mirror the rail.' },
      { id: 'i2', severity: 'low', part: 'lid', checkId: null, change: 'Add a lid.' },
    ],
    newChecks: [{ id: 's1', kind: 'size', text: 'Walls 3 mm' }],
  },
  selected: ['i1'],
  limitReached: false,
  suggestionsAdded: false,
  usage: { inputTokens: 3000, outputTokens: 940, cost: 0.019 },
  error: null,
}

const actions = {
  approvePlan: vi.fn(async () => {}),
  skipPlan: vi.fn(async () => {}),
  setPlanChecks: vi.fn(),
  toggleIssue: vi.fn(),
  fixIssues: vi.fn(async () => {}),
  accept: vi.fn(),
  stop: vi.fn(),
  addSuggestedChecks: vi.fn(async () => {}),
}

beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockClear())
  // The project first: opening another project clears the agent's cards.
  useProjectStore.setState({ project: { id: 'x', name: 'X', createdAt: 0, updatedAt: 0, headVersionId: null, providerProfileId: null, enabledLibraries: [], origin: 'blank', checks: CHECKS } })
  useAgentStore.setState({ cards: { p: plan, r: review }, ...actions })
})

describe('plan card', () => {
  it('lists the checks and parts and approves, edits or skips', () => {
    render(<AgentCardView cardId="p" />)
    const card = screen.getByTestId('plan-card')
    expect(within(card).getByText('Plan · 3 checks')).toBeInTheDocument()
    expect(within(card).getByText('Waiting for you')).toBeInTheDocument()
    expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1PartA body', '2PartRails on both long sides', '3PrintPrints without supports'])
    expect(within(card).getByText('lid_rail')).toBeInTheDocument()
    expect(within(card).getByText(/Planned by builder/)).toHaveTextContent('Planned by builder · 840 tok · $0.004')

    fireEvent.click(screen.getByRole('button', { name: 'Approve and build' }))
    expect(actions.approvePlan).toHaveBeenCalledWith('p')
    fireEvent.click(screen.getByRole('button', { name: 'Skip plan' }))
    expect(actions.skipPlan).toHaveBeenCalledWith('p')
  })

  it('edits checks in place and saves them with Done', () => {
    render(<AgentCardView cardId="p" />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit checks' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Check 1' }), { target: { value: 'A body 40 mm long' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove check 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(actions.setPlanChecks).toHaveBeenCalledWith('p', [
      { id: 'c1', kind: 'part', text: 'A body 40 mm long' },
      { id: 'c2', kind: 'part', text: 'Rails on both long sides' },
    ])
  })

  it('says when planning failed', () => {
    useAgentStore.setState({ cards: { p: { ...plan, status: 'error', checks: [], error: { title: 'The answer could not be read', body: 'Try again.' } } } })
    render(<AgentCardView cardId="p" />)
    expect(screen.getByRole('alert')).toHaveTextContent('The answer could not be read')
    expect(screen.queryByRole('button', { name: 'Approve and build' })).not.toBeInTheDocument()
  })
})

describe('review card', () => {
  it('shows what the reviewer saw, the open checks first, and the passing ones folded', () => {
    render(<AgentCardView cardId="r" />)
    expect(screen.getByText('Review · round 1 · v1')).toBeInTheDocument()
    expect(screen.getByText('1 of 3 fail')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'iso view' })).toHaveAttribute('src', 'blob:iso')
    expect(screen.getByRole('list', { name: 'Part colours' })).toHaveTextContent('lid_raillines 3–4')
    const open = screen.getByRole('list', { name: 'Checks to look at' })
    expect(within(open).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Fail2 · Rails on both long sidesRight view: one rail.',
      'Unclear3 · Prints without supportsOverhang 1.6 mm.',
    ])
    expect(screen.getByText('Show 1 passing check')).toBeInTheDocument()
  })

  it('ticks fixes, names their parts, and sends the ticked ones', () => {
    render(<AgentCardView cardId="r" />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false])
    expect(screen.getByText('lid_rail · lines 3–4')).toBeInTheDocument()
    expect(screen.getByText('new: lid')).toBeInTheDocument()
    expect(screen.getByText('Fixes 2')).toBeInTheDocument()
    expect(screen.getByText('Not in the checks')).toBeInTheDocument()
    fireEvent.click(boxes[1])
    expect(actions.toggleIssue).toHaveBeenCalledWith('r', 'i2')
    fireEvent.click(screen.getByRole('button', { name: 'Fix 1 issue' }))
    expect(actions.fixIssues).toHaveBeenCalledWith('r')
    fireEvent.click(screen.getByRole('button', { name: 'Accept as is' }))
    expect(actions.accept).toHaveBeenCalledWith('r')
    fireEvent.click(screen.getByRole('button', { name: 'Add to checks' }))
    expect(actions.addSuggestedChecks).toHaveBeenCalledWith('r')
  })

  it('offers Stop while reviewing and nothing to tick', () => {
    useAgentStore.setState({ cards: { r: { ...review, status: 'reviewing', review: null, frames: [], selected: [] } } })
    render(<AgentCardView cardId="r" />)
    expect(screen.getByText('Reviewing…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(actions.stop).toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders nothing for a card that is gone', () => {
    const { container } = render(<AgentCardView cardId="missing" />)
    expect(container).toBeEmptyDOMElement()
  })
})
