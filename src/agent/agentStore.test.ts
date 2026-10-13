// @vitest-environment node
import 'fake-indexeddb/auto'
import type { LlmProvider } from '../ai/types'
import { useChatStore } from '../chat/chatStore'
import type { TurnOutcome } from '../chat/sendPrompt'
import { useProjectStore } from '../history/projectStore'
import { useProvidersStore } from '../settings/providersStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { scriptedProvider } from '../test/providers'
import { resetDb } from '../test/resetDb'
import { okResult } from '../test/results'
import type { RenderResult } from '../render/types'
import { db, DEFAULT_SETTINGS, type ProviderProfile } from '../db/db'
import { fixText, useAgentStore, type AgentDeps, type ReviewCard, type SendOptions } from './agentStore'

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
  const sendOpts: Array<SendOptions | undefined> = []
  const ok = okResult() as Extract<RenderResult, { ok: true }>
  const deps: AgentDeps = {
    provider: () => scripted.provider as LlmProvider,
    send: async (text, opts): Promise<TurnOutcome> => {
      const display = opts?.display
      sent.push({ text, display })
      sendOpts.push(opts)
      // Like sendPrompt: the bubble shows the short text and the draft clears.
      useChatStore.getState().addMessage({ role: 'user', text: display ?? text, turnLabel: null, model: null, usage: null, status: 'done' })
      useChatStore.getState().setDraft('')
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
  return { deps, sent, sendOpts, requests: scripted.requests }
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

it('in Edit mode sends one builder turn, and never plans or reviews', async () => {
  const { deps, sent, requests } = setup([])
  await useProjectStore.getState().setAgentMode('edit')
  await agent().submit('A box', deps)
  expect(sent).toEqual([{ text: 'A box', display: undefined }])
  expect(cards()).toEqual([])
  expect(requests).toHaveLength(0)
  expect(useChatStore.getState().messages.every((m) => m.runId === undefined)).toBe(true)
})

it('in Agent mode reviews an edit of an existing model against its checks', async () => {
  const { deps, sent, requests } = setup([PASSES])
  useAppStore.getState().setCode(MODEL_CODE)
  await useProjectStore.getState().setChecks([{ id: 'c1', kind: 'part', text: 'A body' }, { id: 'c2', kind: 'part', text: 'Rails' }])
  await agent().submit('Make it taller', deps)
  expect(sent).toHaveLength(1)
  expect(reviewCards()).toHaveLength(1)
  expect(requests).toHaveLength(1)
})

it('the mode passed with a request wins over the project mode', async () => {
  const { deps, sent } = setup([PLAN])
  await agent().submit('A box', deps, { mode: 'edit' })
  expect(sent).toHaveLength(1)
  expect(cards()).toEqual([])
})

it('tags every message of an agent run with one run id; an edit starts none', async () => {
  const { deps } = setup([PLAN, PASSES, PASSES])
  await agent().submit('A holder', deps)
  await agent().approvePlan(cards()[0].id, deps)
  const run = useChatStore.getState().messages
  const ids = new Set(run.map((m) => m.runId))
  expect(ids.size).toBe(1)
  expect([...ids][0]).toEqual(expect.any(String))

  await useProjectStore.getState().setAgentMode('edit')
  await agent().submit('Make it taller', deps)
  expect(useChatStore.getState().messages.slice(run.length).map((m) => m.runId)).toEqual([undefined])

  // "Review vN" on that edit is a run of its own.
  await agent().reviewNow(deps)
  const review = useChatStore.getState().messages.at(-1)!
  expect(review.runId).toEqual(expect.any(String))
  expect(review.runId).not.toBe([...ids][0])
})

it('builds straight after planning when plan approval is off', async () => {
  const { deps, sent } = setup([PLAN, PASSES], { settings: { reviewApprovePlan: false } })
  await agent().submit('A holder', deps)
  expect(cards()[0]).toMatchObject({ kind: 'plan', status: 'approved' })
  expect(sent).toHaveLength(1)
  expect(reviewCards()[0]).toMatchObject({ status: 'passed' })
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

describe('review findings', () => {
  const UNCLEAR = JSON.stringify({ summary: 'Only judged one.', checks: [{ n: 1, status: 'pass', evidence: 'a' }], issues: [] })
  const PASS_WITH_DEFECT = JSON.stringify({ ...JSON.parse(PASSES), issues: [{ severity: 'low', part: 'body', check: null, change: 'The body floats 1 mm above the bed.' }] })

  async function withChecks() {
    useAppStore.getState().setCode(MODEL_CODE)
    useAppStore.getState().renderFinished(okResult(), MODEL_CODE, {})
    await useProjectStore.getState().setChecks([{ id: 'c1', kind: 'part', text: 'A body' }, { id: 'c2', kind: 'part', text: 'Rails' }])
  }

  it('does not count unclear checks as passing', async () => {
    const { deps } = setup([UNCLEAR])
    await withChecks()
    await agent().reviewNow(deps)
    expect(reviewCards()[0].status).toBe('ready')
    expect(useChatStore.getState().messages.at(-1)?.text).toBe('Review · round 1: 1 of 2 checks unclear')
  })

  it('keeps fixing open for defects outside the checks when every check passes', async () => {
    const { deps } = setup([PASS_WITH_DEFECT])
    await withChecks()
    await agent().reviewNow(deps)
    const card = reviewCards()[0]
    expect(card.status).toBe('ready')
    expect(card.selected).toEqual([])
    expect(useChatStore.getState().messages.at(-1)?.text).toBe('Review · round 1: all 2 checks pass')
  })

  it('ignores actions on cards while the builder or the agent is busy', async () => {
    const { deps, sent } = setup([FAILS])
    await withChecks()
    await agent().reviewNow(deps)
    const card = reviewCards()[0]
    useChatStore.setState({ busy: true })
    await agent().fixIssues(card.id, deps)
    expect(sent).toEqual([])
    expect(agent().cards[card.id]).toMatchObject({ status: 'ready' })
  })

  it('marks older open cards out of date when a newer change is built', async () => {
    const { deps } = setup([FAILS])
    await withChecks()
    await agent().reviewNow(deps)
    const old = reviewCards()[0]
    await agent().submit('Make it taller', deps)
    expect(agent().cards[old.id]).toMatchObject({ status: 'superseded' })
    expect(useChatStore.getState().messages.find((m) => m.id === old.noteId)?.text).toBe('Review · round 1: out of date')
  })

  it('clears the composer when a request goes to planning', async () => {
    const { deps } = setup([PLAN])
    useChatStore.getState().setDraft('A holder')
    await agent().submit('A holder', deps)
    expect(useChatStore.getState().draft).toBe('')
  })

  it('tells the reviewer the user request, not the fix round, as the latest request', async () => {
    const { deps, requests } = setup([PLAN, FAILS, PASSES])
    await agent().submit('A holder', deps)
    await agent().approvePlan(cards()[0].id, deps)
    await agent().fixIssues(reviewCards()[0].id, deps)
    const text = JSON.stringify(requests[2].messages)
    expect(text).toContain('Original request: A holder')
    expect(text).not.toContain('Latest request: Fix')
  })

  it('says so when the model changed before a review plan was approved', async () => {
    const { deps } = setup([PLAN])
    useAppStore.getState().setCode(MODEL_CODE)
    useAppStore.getState().renderFinished(okResult(), MODEL_CODE, {})
    useChatStore.getState().addMessage({ role: 'user', text: 'A holder', turnLabel: null, model: null, usage: null, status: 'done' })
    await agent().reviewNow(deps)
    useAppStore.getState().setCode(`${MODEL_CODE}// edited\n`)
    await agent().approvePlan(cards()[0].id, deps)
    expect(cards()[0]).toMatchObject({ status: 'error', error: { title: 'The model changed since the plan' } })
    expect(reviewCards()).toEqual([])
  })
})

it('passes the project photos to the planner and the reviewer, and shows them on the first request', async () => {
  const project = useProjectStore.getState().project!
  useProjectStore.setState({ project: { ...project, origin: 'photos', photos: [{ id: 'a', blobId: 'blob-a', angle: 'front', addedAt: 1 }], scale: 'reference' } })
  await db.blobs.put({ id: 'blob-a', kind: 'image', data: new Blob(['f'], { type: 'image/jpeg' }) })
  const { deps, sendOpts, requests } = setup([PLAN, PASSES], { settings: { reviewApprovePlan: false } })
  await agent().submit('A bracket', deps, { showPhotos: true })
  const planContent = requests[0].messages[0].content as Array<{ type: string; text?: string }>
  expect(planContent.map((p) => p.type)).toEqual(['text', 'text', 'image'])
  expect(planContent[1]).toEqual({ type: 'text', text: 'Reference photo (front)' })
  expect(sendOpts[0]).toEqual({ display: 'A bracket', transcript: undefined, showPhotos: true })
  const reviewContent = requests[1].messages[0].content as Array<{ type: string; text?: string; data?: string }>
  expect(reviewContent.slice(-2)).toEqual([{ type: 'text', text: 'Reference photo (front)' }, { type: 'image', mediaType: 'image/jpeg', data: btoa('f') }])
})

it('keeps the first request without photos in the bubble when it was not asked to show them', async () => {
  const { deps, sendOpts } = setup([], { visionOn: false })
  await agent().submit('A box', deps)
  expect(sendOpts[0]).toEqual({ display: undefined, transcript: undefined, showPhotos: false })
})
