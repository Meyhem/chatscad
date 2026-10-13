import type { ChatMessage } from '../chat/chatStore'
import type { PlanCard, ReviewCard } from './agentStore'
import { groupRuns, runSteps } from './runSteps'

const m = (over: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage => ({
  text: '', turnLabel: null, model: null, usage: null, status: 'done', ...over,
})

const plan = (status: PlanCard['status']): PlanCard => ({
  kind: 'plan', id: 'p', noteId: 'np', request: 'A holder', then: 'build', status,
  checks: [{ id: 'c1', kind: 'part', text: 'A' }, { id: 'c2', kind: 'part', text: 'B' }], parts: [], model: 'm', usage: null, error: null,
})

const review = (round: number, status: ReviewCard['status'], fails: number): ReviewCard => ({
  kind: 'review', id: `r${round}`, noteId: `nr${round}`, round, status, model: 'gpt-5', versionLabel: null, frames: [], legend: [], coloured: true,
  review: status === 'reviewing' ? null : {
    summary: '', issues: [], newChecks: [],
    verdicts: [{ checkId: 'c1', status: fails > 0 ? 'fail' : 'pass', evidence: '' }, { checkId: 'c2', status: fails > 1 ? 'fail' : 'pass', evidence: '' }],
  },
  selected: [], limitReached: false, suggestionsAdded: false, usage: null, error: null,
})

it('groups consecutive messages of one run, and leaves edits on their own', () => {
  const items = groupRuns([
    m({ id: '1', role: 'user' }),
    m({ id: '2', role: 'assistant' }),
    m({ id: '3', role: 'user', runId: 'a' }),
    m({ id: '4', role: 'assistant', runId: 'a' }),
    m({ id: '5', role: 'user', runId: 'b' }),
  ])
  expect(items.map((i) => (i.kind === 'run' ? `run ${i.runId}: ${i.messages.map((x) => x.id).join()}` : `msg ${i.message.id}`))).toEqual([
    'msg 1',
    'msg 2',
    'run a: 3,4',
    'run b: 5',
  ])
})

it('lists the plan, the build, each review and each fix, with their state', () => {
  const messages = [
    m({ id: 'u', role: 'user', runId: 'a' }),
    m({ id: 'np', role: 'note', cardId: 'p', runId: 'a' }),
    m({ id: 'b1', role: 'assistant', turnLabel: 'v1', compileStatus: 'ok', runId: 'a' }),
    m({ id: 'nr1', role: 'note', cardId: 'r1', runId: 'a' }),
    m({ id: 'b2', role: 'assistant', status: 'streaming', runId: 'a' }),
  ]
  const steps = runSteps(messages, { p: plan('approved'), r1: review(1, 'fixed', 1) })
  expect(steps.map((s) => `${s.state} ${s.label}`)).toEqual(['done Plan · 2 checks', 'done Build v1', 'fail Review 1 · 1 fail', 'active Fix'])
})

it('says when a step waits for the user, and shows a passed review', () => {
  expect(runSteps([m({ id: 'np', role: 'note', cardId: 'p' })], { p: plan('ready') })).toEqual([{ id: 'np', label: 'Plan · 2 checks', state: 'wait' }])
  expect(runSteps([m({ id: 'nr2', role: 'note', cardId: 'r2' })], { r2: review(2, 'passed', 0) })[0]).toMatchObject({ label: 'Review 2 · pass', state: 'done' })
  expect(runSteps([m({ id: 'nr1', role: 'note', cardId: 'r1' })], { r1: review(1, 'reviewing', 0) })[0]).toMatchObject({ label: 'Review 1', state: 'active' })
})

it('falls back to the note text once the cards are gone (a reloaded project)', () => {
  const steps = runSteps(
    [
      m({ id: 'n1', role: 'note', text: 'Review · round 1: 2 of 7 checks fail' }),
      m({ id: 'n2', role: 'note', text: 'Review · round 2: all 7 checks pass' }),
      m({ id: 'n3', role: 'note', text: 'Auto-fix stopped after 2 attempts.' }),
    ],
    {},
  )
  expect(steps.map((s) => `${s.state} ${s.label}`)).toEqual(['fail Review · round 1: 2 of 7 checks fail', 'done Review · round 2: all 7 checks pass'])
})
