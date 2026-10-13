// @vitest-environment node
import 'fake-indexeddb/auto'
import type { LlmProvider } from '../ai/types'
import { useChatStore } from '../chat/chatStore'
import type { TurnOutcome } from '../chat/sendPrompt'
import { DEFAULT_SETTINGS, type ProviderProfile } from '../db/db'
import { useProjectStore } from '../history/projectStore'
import { useProvidersStore } from '../settings/providersStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { scriptedProvider } from '../test/providers'
import { resetDb } from '../test/resetDb'
import { okResult } from '../test/results'
import type { RenderResult } from '../render/types'
import { fixText, useAgentStore, type AgentDeps, type ReviewCard } from './agentStore'

const MODEL_CODE = 'module body() cube([40, 20, 10]);\nmodule lid_rail() translate([0, 20, 8]) cube([40, 2, 2]);\nbody();\nlid_rail();\n'

const vision: ProviderProfile = {
  id: 'p1',
  name: 'Vision',
  adapter: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  apiKey: 'k',
  defaultModel: 'builder',
  cachedModels: [],
  capabilities: { streaming: true, vision: true, audio: false },
  priceTable: {},
  createdAt: 0,
  updatedAt: 0,
}

const PLAN = JSON.stringify({ checks: [{ kind: 'part', text: 'A body' }, { kind: 'part', text: 'Rails on both long sides' }], parts: ['body', 'lid_rail'] })
const FAILS = JSON.stringify({
  summary: 'One rail only.',
  checks: [{ n: 1, status: 'pass', evidence: 'Body in every view.' }, { n: 2, status: 'fail', evidence: 'Right view: one rail.' }],
  issues: [
    { severity: 'high', part: 'lid_rail', check: 2, change: 'Mirror the rail onto the other side.' },
    { severity: 'low', part: 'body', check: null, change: 'Chamfer the top edge.' },
  ],
  newChecks: [],
})
const PASSES = JSON.stringify({ summary: 'All good.', checks: [{ n: 1, status: 'pass', evidence: 'a' }, { n: 2, status: 'pass', evidence: 'b' }], issues: [] })

function setup(replies: string[], opts: { visionOn?: boolean; settings?: Partial<typeof DEFAULT_SETTINGS> } = {}) {
  const profile = { ...vision, capabilities: { ...vision.capabilities, vision: opts.visionOn ?? true } }
  useProvidersStore.setState({ profiles: [profile], settings: { ...DEFAULT_SETTINGS, activeProfileId: 'p1', activeModel: 'builder' }, loaded: true })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ...opts.settings }, loaded: true })
  const scripted = scriptedProvider(...replies)
  const sent: Array<{ text: string; display?: string }> = []
  const ok = okResult() as Extract<RenderResult, { ok: true }>
  const deps: AgentDeps = {
    provider: () => scripted.provider as LlmProvider,
    send: async (text, display): Promise<TurnOutcome> => {
      sent.push({ text, display })
      const startedEmpty = useAppStore.getState().code.trim() === ''
      useAppStore.getState().setCode(MODEL_CODE, 'ai')
      useAppStore.getState().renderFinished(ok, MODEL_CODE, {})
      return { sent: true, startedEmpty, rendered: ok, stopped: false }
    },
    review: {
      renderTagged: async () => ({ ...ok, mesh: { ...ok.mesh, faceTags: new Uint32Array([1, 2]) } }),
      frames: async () => [{ view: 'iso', png: new Blob(['x']) }],
      toBase64: async () => 'eA==',
    },
    recordUsage: async () => {},
    objectUrl: () => 'blob:frame',
  }
  return { deps, sent, requests: scripted.requests }
}

const agent = () => useAgentStore.getState()
const cards = () => Object.values(agent().cards)
const reviewCards = () => cards().filter((c): c is ReviewCard => c.kind === 'review')

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useChatStore.setState(useChatStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  await useProjectStore.getState().newProject({ code: '', origin: 'blank' })
})

it('builds straight away when no model takes images, and never plans or reviews', async () => {
  const { deps, sent, requests } = setup([], { visionOn: false })
  await agent().submit('A box', deps)
  expect(sent).toEqual([{ text: 'A box', display: undefined }])
  expect(cards()).toEqual([])
  expect(requests).toHaveLength(0)
})

it('plans a new model first, then builds with the checks and part names once the plan is approved', async () => {
  const { deps, sent } = setup([PLAN, FAILS])
  await agent().submit('A holder with a sliding lid', deps)
  expect(sent).toEqual([])
  const plan = cards()[0]
  expect(plan).toMatchObject({ kind: 'plan', status: 'ready', request: 'A holder with a sliding lid', parts: ['body', 'lid_rail'] })
  expect(useChatStore.getState().messages.at(-1)).toMatchObject({ role: 'note', cardId: plan.id })

  await agent().approvePlan(plan.id, deps)
  expect(useProjectStore.getState().project?.checks?.map((c) => c.text)).toEqual(['A body', 'Rails on both long sides'])
  expect(sent[0].display).toBe('A holder with a sliding lid')
  expect(sent[0].text).toContain('Name the modules: body, lid_rail.')
  expect(sent[0].text).toContain('1. A body\n2. Rails on both long sides')

  const review = reviewCards()[0]
  expect(review).toMatchObject({ status: 'ready', round: 1 })
  expect(review.review?.verdicts.map((v) => v.status)).toEqual(['pass', 'fail'])
  // Fixes for failed checks start ticked; others do not.
  expect(review.selected).toEqual([review.review!.issues[0].id])
})

it('skips the plan: builds without review', async () => {
  const { deps, sent } = setup([PLAN])
  await agent().submit('A box', deps)
  await agent().skipPlan(cards()[0].id, deps)
  expect(sent).toEqual([{ text: 'A box', display: undefined }])
  expect(reviewCards()).toEqual([])
  expect(cards()[0]).toMatchObject({ status: 'skipped' })
})

it('does not review an edit of an existing model unless asked', async () => {
  const { deps, sent, requests } = setup([PASSES])
  useAppStore.getState().setCode(MODEL_CODE)
  await useProjectStore.getState().setChecks([{ id: 'c1', kind: 'part', text: 'A body' }, { id: 'c2', kind: 'part', text: 'Rails' }])
  await agent().submit('Make it taller', deps)
  expect(sent).toHaveLength(1)
  expect(reviewCards()).toEqual([])

  agent().setReviewNext(true)
  await agent().submit('Make it wider', deps)
  expect(reviewCards()).toHaveLength(1)
  expect(agent().reviewNext).toBe(false)
  expect(requests).toHaveLength(1)
})

it('sends the ticked fixes back to the builder and reviews the next round', async () => {
  const { deps, sent } = setup([PLAN, FAILS, PASSES])
  await agent().submit('A holder', deps)
  await agent().approvePlan(cards()[0].id, deps)
  const first = reviewCards()[0]
  await agent().fixIssues(first.id, deps)
  expect(sent[1].display).toBe('Fix 1 issue from the review')
  expect(sent[1].text).toBe(fixText(first.review!.issues.slice(0, 1), first.legend))
  expect(sent[1].text).toContain('1. lid_rail: Mirror the rail onto the other side.')
  expect(agent().cards[first.id]).toMatchObject({ status: 'fixed' })
  const second = reviewCards().find((c) => c.id !== first.id)!
  expect(second).toMatchObject({ round: 2, status: 'passed' })
})

it('in auto mode fixes on its own until every check passes', async () => {
  const { deps, sent } = setup([PLAN, FAILS, FAILS, PASSES], { settings: { reviewMode: 'auto', reviewRounds: 3 } })
  await agent().submit('A holder', deps)
  await agent().approvePlan(cards()[0].id, deps)
  expect(sent).toHaveLength(3)
  expect(reviewCards().map((c) => c.status)).toEqual(['fixed', 'fixed', 'passed'])
})

it('in auto mode stops at the round limit and leaves the last fixes to the user', async () => {
  const { deps, sent } = setup([PLAN, FAILS, FAILS], { settings: { reviewMode: 'auto', reviewRounds: 2 } })
  await agent().submit('A holder', deps)
  await agent().approvePlan(cards()[0].id, deps)
  expect(sent).toHaveLength(2)
  expect(reviewCards().map((c) => c.status)).toEqual(['fixed', 'ready'])
  expect(reviewCards()[1].limitReached).toBe(true)
})

it('reviews the current model on request, planning checks first when there are none', async () => {
  const { deps, sent } = setup([PLAN, PASSES])
  useAppStore.getState().setCode(MODEL_CODE)
  const ok = okResult()
  useAppStore.getState().renderFinished(ok, MODEL_CODE, {})
  useChatStore.getState().addMessage({ role: 'user', text: 'A holder', turnLabel: null, model: null, usage: null, status: 'done' })
  await agent().reviewNow(deps)
  const plan = cards()[0]
  expect(plan).toMatchObject({ kind: 'plan', then: 'review', request: 'A holder' })
  await agent().approvePlan(plan.id, deps)
  expect(sent).toEqual([])
  expect(reviewCards()[0]).toMatchObject({ status: 'passed', round: 1 })
})

it('adds suggested checks to the project', async () => {
  const withSuggestion = JSON.stringify({ ...JSON.parse(PASSES), newChecks: [{ kind: 'size', text: 'Walls 3 mm' }] })
  const { deps } = setup([withSuggestion])
  useAppStore.getState().setCode(MODEL_CODE)
  useAppStore.getState().renderFinished(okResult(), MODEL_CODE, {})
  await useProjectStore.getState().setChecks([{ id: 'c1', kind: 'part', text: 'A body' }, { id: 'c2', kind: 'part', text: 'Rails' }])
  await agent().reviewNow(deps)
  await agent().addSuggestedChecks(reviewCards()[0].id)
  expect(useProjectStore.getState().project?.checks?.map((c) => c.text)).toEqual(['A body', 'Rails', 'Walls 3 mm'])
  expect(reviewCards()[0].suggestionsAdded).toBe(true)
})

it('shows a provider error on the card', async () => {
  const { deps } = setup([])
  useAppStore.getState().setCode('')
  deps.provider = () => scriptedProvider(new Error('boom')).provider
  await agent().submit('A box', deps)
  expect(cards()[0]).toMatchObject({ kind: 'plan', status: 'error' })
})
