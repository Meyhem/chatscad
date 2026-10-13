import { create } from 'zustand'
import { computeCost, priceFor } from '../ai/cost'
import { createProvider } from '../ai/createProvider'
import { describeProviderError } from '../ai/errors'
import type { LlmProvider, Usage } from '../ai/types'
import { useChatStore } from '../chat/chatStore'
import { sendPrompt, stopTurn, type TurnOutcome } from '../chat/sendPrompt'
import type { ProviderProfile } from '../db/db'
import type { PresetView } from '../export/frames'
import { useProjectStore } from '../history/projectStore'
import { blobToBase64 } from '../images/base64'
import { errorMessage } from '../render/result'
import { getRenderQueue } from '../render/sharedQueue'
import type { RenderResult } from '../render/types'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { useSettingsStore } from '../settings/settingsStore'
import { isEmptyCode, useAppStore } from '../state/store'
import { MAX_CHECKS, newCheck, type Check } from './checks'
import { renderReviewFrames } from './frames'
import { runPlan } from './plan'
import { selectReviewer, type ReviewerChoice } from './reviewer'
import { runReview, type Issue, type LegendEntry, type Review, type ReviewDeps } from './review'
import { recordAgentUsage } from './usage'

export interface CardUsage {
  inputTokens: number
  outputTokens: number
  cost: number | null
}

export interface PlanCard {
  kind: 'plan'
  id: string
  noteId: string
  request: string
  /** What approving does: build the model, or review the model already there ("Review vN" without checks). */
  then: 'build' | 'review'
  status: 'planning' | 'ready' | 'approved' | 'skipped' | 'error' | 'stopped' | 'superseded'
  checks: Check[]
  parts: string[]
  model: string
  usage: CardUsage | null
  error: { title: string; body: string } | null
  /** The dictated transcript behind the request, kept for the build. */
  transcript?: string
}

export interface ReviewCard {
  kind: 'review'
  id: string
  noteId: string
  round: number
  /** 'superseded': a newer change was built, so its issues describe older code. */
  status: 'reviewing' | 'ready' | 'passed' | 'fixed' | 'accepted' | 'error' | 'stopped' | 'superseded'
  model: string
  versionLabel: string | null
  frames: Array<{ view: PresetView; url: string }>
  legend: LegendEntry[]
  coloured: boolean
  review: Review | null
  /** Issue ids the next "Fix" sends. */
  selected: string[]
  /** Auto mode reached the round limit with checks still failing. */
  limitReached: boolean
  suggestionsAdded: boolean
  usage: CardUsage | null
  error: { title: string; body: string } | null
}

export type AgentCard = PlanCard | ReviewCard

export interface AgentDeps {
  send(text: string, display?: string, transcript?: string): Promise<TurnOutcome>
  provider(profile: ProviderProfile): LlmProvider
  review: ReviewDeps
  recordUsage(input: { profile: ProviderProfile; model: string; usage: Usage; projectId: string | null }): Promise<unknown>
  objectUrl(blob: Blob): string
}

const browserDeps: AgentDeps = {
  send: (text, display, transcript) => {
    const extra = { ...(display ? { displayText: display } : {}), ...(transcript ? { audioTranscript: transcript } : {}) }
    return Object.keys(extra).length > 0 ? sendPrompt(text, extra) : sendPrompt(text)
  },
  provider: createProvider,
  review: {
    renderTagged: (req, signal) => getRenderQueue().render(req, signal),
    frames: (mesh, faceTags) => renderReviewFrames(mesh, faceTags),
    toBase64: blobToBase64,
  },
  recordUsage: (input) => recordAgentUsage(input),
  objectUrl: (blob) => URL.createObjectURL(blob),
}

export interface AgentState {
  cards: Record<string, AgentCard>
  /** The Review switch for the next request; it resets after each send. */
  reviewNext: boolean
  busy: 'planning' | 'reviewing' | null
  /** The request that started the current model: what every review judges against. */
  anchor: string | null
  /** The user's latest request (fix rounds excluded): the reviewer's "latest request". */
  latest: string | null
  /** The viewer paints each part in its review colour (spec A9). */
  partColours: boolean
  setPartColours(on: boolean): void
  setReviewNext(on: boolean): void
  submit(text: string, deps?: AgentDeps, extra?: { audioTranscript?: string }): Promise<void>
  approvePlan(cardId: string, deps?: AgentDeps): Promise<void>
  skipPlan(cardId: string, deps?: AgentDeps): Promise<void>
  setPlanChecks(cardId: string, checks: Check[]): void
  reviewNow(deps?: AgentDeps): Promise<void>
  toggleIssue(cardId: string, issueId: string): void
  fixIssues(cardId: string, deps?: AgentDeps): Promise<void>
  accept(cardId: string): void
  addSuggestedChecks(cardId: string): Promise<void>
  stop(): void
  reset(): void
}

/** The reviewer for the current settings, or null when no model takes images. */
export function currentReviewer(): ReviewerChoice | null {
  const providers = useProvidersStore.getState()
  const settings = useSettingsStore.getState().settings
  return selectReviewer({
    profiles: providers.profiles,
    activeProfile: selectActiveProfile(providers),
    activeModel: selectActiveModel(providers),
    reviewProfileId: settings.reviewProfileId,
    reviewModel: settings.reviewModel,
  })
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What the builder gets after an approved plan: the request, the module names and the checks. */
export function buildText(request: string, checks: Check[], parts: string[]): string {
  const lines = [request.trim(), '']
  if (parts.length > 0) lines.push(`Name the modules: ${parts.join(', ')}.`)
  lines.push('The model must meet these checks:', ...checks.map((c, i) => `${i + 1}. ${c.text}`))
  return lines.join('\n')
}

/** What the builder gets for "Fix N issues": one line per issue, naming the part it is about. */
export function fixText(issues: Issue[], legend: LegendEntry[]): string {
  const known = new Set(legend.map((l) => l.label))
  const lines = issues.map((issue, i) => {
    const where = issue.part === null ? '' : known.has(issue.part) ? `${issue.part}: ` : `New part ${issue.part}: `
    return `${i + 1}. ${where}${issue.change}`
  })
  return ['Fix these problems the reviewer found:', ...lines, 'Change only what these need.'].join('\n')
}

function cardUsage(choice: ReviewerChoice | { profile: ProviderProfile; model: string }, usage: Usage): CardUsage {
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: computeCost(usage, priceFor(choice.profile, choice.model)).cost }
}

function planSummary(card: PlanCard): string {
  switch (card.status) {
    case 'planning':
      return 'Planning checks…'
    case 'error':
      return 'Plan failed.'
    case 'stopped':
      return 'Plan stopped.'
    case 'skipped':
      return `Plan skipped · ${plural(card.checks.length, 'check')}`
    case 'superseded':
      return `Plan · ${plural(card.checks.length, 'check')} · not used`
    default:
      return `Plan · ${plural(card.checks.length, 'check')}`
  }
}

function reviewSummary(card: ReviewCard): string {
  const head = `Review · round ${card.round}`
  if (card.status === 'reviewing') return `${head}: reviewing…`
  if (card.status === 'error') return `${head}: failed.`
  if (card.status === 'stopped') return `${head}: stopped.`
  if (card.status === 'superseded') return `${head}: out of date`
  const verdicts = card.review?.verdicts ?? []
  const failed = verdicts.filter((v) => v.status === 'fail').length
  const unclear = verdicts.filter((v) => v.status === 'unclear').length
  if (failed > 0) return `${head}: ${failed} of ${plural(verdicts.length, 'check')} fail`
  if (unclear > 0) return `${head}: ${unclear} of ${plural(verdicts.length, 'check')} unclear`
  return `${head}: all ${plural(verdicts.length, 'check')} pass`
}

const note = (text: string, cardId: string) =>
  useChatStore.getState().addMessage({ role: 'note', text, turnLabel: null, model: null, usage: null, status: 'done', cardId })

let running: AbortController | null = null

const wasAborted = (err: unknown, signal: AbortSignal) => signal.aborted || (err instanceof DOMException && err.name === 'AbortError')

function cardError(err: unknown, baseUrl: string): { title: string; body: string } {
  const message = errorMessage(err)
  if (/^The (reply|plan|review) had no/.test(message)) return { title: 'The answer could not be read', body: `${message}. Try again, or choose another model.` }
  return describeProviderError(err, baseUrl)
}

/** Aborts `controller` when the user edits the code or a parameter while it runs, like a chat turn. */
function stopOnEdit(controller: AbortController): () => void {
  return useAppStore.subscribe((s, prev) => {
    if ((s.code !== prev.code && s.codeSource === 'manual') || (s.params !== prev.params && s.code === prev.code)) controller.abort()
  })
}

/** The builder or the agent is working; card actions wait until it is done. */
export function isBusy(): boolean {
  return useAgentStore.getState().busy !== null || useChatStore.getState().busy
}

/** The editor's code is the code of the last successful render. */
function currentModelRendered(): boolean {
  const app = useAppStore.getState()
  return app.lastRender?.code === app.code && app.lastRender.result.ok
}

function firstUserText(): string | null {
  return useChatStore.getState().messages.find((m) => m.role === 'user')?.text ?? null
}

function lastUserText(): string | null {
  return [...useChatStore.getState().messages].reverse().find((m) => m.role === 'user')?.text ?? null
}

export const useAgentStore = create<AgentState>()((set, get) => {
  const patch = <C extends AgentCard>(id: string, change: Partial<C>) => {
    const card = get().cards[id]
    if (!card) return
    const next = { ...card, ...change } as AgentCard
    set((s) => ({ cards: { ...s.cards, [id]: next } }))
    useChatStore.getState().patchMessage(next.noteId, { text: next.kind === 'plan' ? planSummary(next) : reviewSummary(next) })
  }

  const addCard = (card: Omit<PlanCard, 'noteId'> | Omit<ReviewCard, 'noteId'>): string => {
    const summary = card.kind === 'plan' ? planSummary(card as PlanCard) : reviewSummary(card as ReviewCard)
    const noteId = note(summary, card.id)
    set((s) => ({ cards: { ...s.cards, [card.id]: { ...card, noteId } as AgentCard } }))
    return card.id
  }

  async function plan(request: string, then: PlanCard['then'], deps: AgentDeps, transcript?: string): Promise<void> {
    const providers = useProvidersStore.getState()
    const profile = selectActiveProfile(providers)
    const model = selectActiveModel(providers)
    if (!profile || !model) return
    const id = addCard({
      kind: 'plan',
      id: crypto.randomUUID(),
      request,
      then,
      status: 'planning',
      checks: [],
      parts: [],
      model,
      usage: null,
      error: null,
      ...(transcript ? { transcript } : {}),
    })
    const controller = new AbortController()
    running = controller
    set({ busy: 'planning' })
    try {
      const result = await runPlan({ provider: deps.provider(profile), model, request, signal: controller.signal })
      void deps.recordUsage({ profile, model, usage: result.usage, projectId: useProjectStore.getState().project?.id ?? null }).catch(() => {})
      patch<PlanCard>(id, { status: 'ready', checks: result.checks, parts: result.parts, usage: cardUsage({ profile, model }, result.usage) })
    } catch (err) {
      patch<PlanCard>(id, wasAborted(err, controller.signal) ? { status: 'stopped' } : { status: 'error', error: cardError(err, profile.baseUrl) })
    } finally {
      if (running === controller) running = null
      set({ busy: null })
    }
  }

  /** A newer change makes open cards stale: their issues and plans describe older code. */
  function supersedeOpenCards(): void {
    for (const card of Object.values(get().cards)) if (card.status === 'ready') patch(card.id, { status: 'superseded' })
  }

  async function build(text: string, display: string | undefined, review: boolean, round: number, deps: AgentDeps, transcript?: string): Promise<void> {
    supersedeOpenCards()
    const outcome = await deps.send(text, display, transcript)
    if (!review || !outcome?.sent || outcome.stopped || !outcome.rendered?.ok) return
    await reviewRound(round, deps)
  }

  async function reviewRound(round: number, deps: AgentDeps): Promise<void> {
    const reviewer = currentReviewer()
    const checks = useProjectStore.getState().project?.checks ?? []
    const app = useAppStore.getState()
    const base: RenderResult | null = currentModelRendered() && app.lastRender ? app.lastRender.result : null
    if (!reviewer || checks.length === 0 || !base?.ok) return
    const settings = useSettingsStore.getState().settings
    const id = addCard({
      kind: 'review',
      id: crypto.randomUUID(),
      round,
      status: 'reviewing',
      model: reviewer.model,
      versionLabel: useProjectStore.getState().head?.label ?? null,
      frames: [],
      legend: [],
      coloured: false,
      review: null,
      selected: [],
      limitReached: false,
      suggestionsAdded: false,
      usage: null,
      error: null,
    })
    const controller = new AbortController()
    running = controller
    const unsubscribe = stopOnEdit(controller)
    set({ busy: 'reviewing' })
    let next: ReviewCard | null = null
    try {
      const request = get().anchor ?? firstUserText() ?? lastUserText() ?? ''
      const outcome = await runReview(
        {
          provider: deps.provider(reviewer.profile),
          model: reviewer.model,
          request,
          latest: get().latest ?? request,
          checks,
          code: app.code,
          params: app.params,
          libraries: app.libraries,
          base,
          signal: controller.signal,
        },
        deps.review,
      )
      void deps.recordUsage({ ...reviewer, usage: outcome.usage, projectId: useProjectStore.getState().project?.id ?? null }).catch(() => {})
      const failed = new Set(outcome.review.verdicts.filter((v) => v.status === 'fail').map((v) => v.checkId))
      const allPass = outcome.review.verdicts.every((v) => v.status === 'pass')
      // Passed means nothing left to do; defects outside the checks keep the card open for fixing.
      const passed = allPass && outcome.review.issues.length === 0
      const auto = settings.reviewMode === 'auto'
      patch<ReviewCard>(id, {
        status: passed ? 'passed' : 'ready',
        review: outcome.review,
        legend: outcome.legend,
        coloured: outcome.coloured,
        frames: outcome.frames.map((f) => ({ view: f.view, url: deps.objectUrl(f.png) })),
        selected: outcome.review.issues.filter((i) => i.checkId !== null && failed.has(i.checkId)).map((i) => i.id),
        limitReached: auto && !allPass && round >= settings.reviewRounds,
        usage: cardUsage(reviewer, outcome.usage),
      })
      next = get().cards[id] as ReviewCard
    } catch (err) {
      patch<ReviewCard>(id, wasAborted(err, controller.signal) ? { status: 'stopped' } : { status: 'error', error: cardError(err, reviewer.profile.baseUrl) })
    } finally {
      unsubscribe()
      if (running === controller) running = null
      set({ busy: null })
    }
    if (next && next.status === 'ready' && settings.reviewMode === 'auto' && !next.limitReached && next.selected.length > 0) {
      await get().fixIssues(id, deps)
    }
  }

  return {
    cards: {},
    reviewNext: false,
    busy: null,
    anchor: null,
    latest: null,
    partColours: false,

    setPartColours: (on) => set({ partColours: on }),
    setReviewNext: (on) => set({ reviewNext: on }),

    async submit(text, deps = browserDeps, extra = {}) {
      const request = text.trim()
      if (request === '' || isBusy()) return
      const newModel = isEmptyCode(useAppStore.getState().code)
      const reviewer = currentReviewer()
      const review = reviewer !== null && (get().reviewNext || (useSettingsStore.getState().settings.reviewNewModels && newModel))
      set({ reviewNext: false, latest: request, ...(newModel ? { anchor: request } : {}) })
      const checks = useProjectStore.getState().project?.checks ?? []
      if (review && checks.length === 0) {
        // The request now lives on the plan card; an Enter on the same text would plan it twice.
        useChatStore.getState().setDraft('')
        supersedeOpenCards()
        await plan(request, 'build', deps, extra.audioTranscript)
        return
      }
      await build(request, undefined, review, 1, deps, extra.audioTranscript)
    },

    async approvePlan(cardId, deps = browserDeps) {
      const card = get().cards[cardId]
      if (card?.kind !== 'plan' || card.status !== 'ready' || card.checks.length === 0 || isBusy()) return
      if (card.then === 'review' && !currentModelRendered()) {
        patch<PlanCard>(cardId, {
          status: 'error',
          error: { title: 'The model changed since the plan', body: 'Wait until it has rendered, then press Review again.' },
        })
        return
      }
      patch<PlanCard>(cardId, { status: 'approved' })
      await useProjectStore.getState().setChecks(card.checks)
      set({ anchor: card.request })
      if (card.then === 'review') await reviewRound(1, deps)
      else await build(buildText(card.request, card.checks, card.parts), card.request, true, 1, deps, card.transcript)
    },

    async skipPlan(cardId, deps = browserDeps) {
      const card = get().cards[cardId]
      if (card?.kind !== 'plan' || card.status !== 'ready' || isBusy()) return
      patch<PlanCard>(cardId, { status: 'skipped' })
      if (card.then === 'build') await build(card.request, undefined, false, 1, deps, card.transcript)
    },

    setPlanChecks(cardId, checks) {
      const card = get().cards[cardId]
      if (card?.kind !== 'plan' || card.status !== 'ready') return
      patch<PlanCard>(cardId, { checks: checks.filter((c) => c.text.trim() !== '').slice(0, MAX_CHECKS) })
    },

    async reviewNow(deps = browserDeps) {
      if (isBusy() || !currentReviewer()) return
      const checks = useProjectStore.getState().project?.checks ?? []
      if (checks.length > 0) {
        await reviewRound(1, deps)
        return
      }
      const request = get().anchor ?? firstUserText() ?? lastUserText()
      if (request) {
        supersedeOpenCards()
        await plan(request, 'review', deps)
      }
    },

    toggleIssue(cardId, issueId) {
      const card = get().cards[cardId]
      if (card?.kind !== 'review' || card.status !== 'ready') return
      const selected = card.selected.includes(issueId) ? card.selected.filter((i) => i !== issueId) : [...card.selected, issueId]
      patch<ReviewCard>(cardId, { selected })
    },

    async fixIssues(cardId, deps = browserDeps) {
      const card = get().cards[cardId]
      if (card?.kind !== 'review' || card.status !== 'ready' || !card.review || isBusy()) return
      const issues = card.review.issues.filter((i) => card.selected.includes(i.id))
      if (issues.length === 0) return
      patch<ReviewCard>(cardId, { status: 'fixed' })
      await build(fixText(issues, card.legend), `Fix ${plural(issues.length, 'issue')} from the review`, true, card.round + 1, deps)
    },

    accept(cardId) {
      const card = get().cards[cardId]
      if (card?.kind === 'review' && card.status === 'ready') patch<ReviewCard>(cardId, { status: 'accepted' })
    },

    async addSuggestedChecks(cardId) {
      const card = get().cards[cardId]
      if (card?.kind !== 'review' || !card.review || card.suggestionsAdded) return
      const current = useProjectStore.getState().project?.checks ?? []
      const added = card.review.newChecks.map((c) => newCheck(c.kind, c.text))
      await useProjectStore.getState().setChecks([...current, ...added].slice(0, MAX_CHECKS))
      patch<ReviewCard>(cardId, { suggestionsAdded: true })
    },

    stop() {
      running?.abort()
      stopTurn()
    },

    reset() {
      for (const card of Object.values(get().cards)) if (card.kind === 'review') for (const f of card.frames) URL.revokeObjectURL?.(f.url)
      set({ cards: {}, reviewNext: false, anchor: null, latest: null })
    },
  }
})

// Cards belong to the open project's chat; a different project starts clean.
let openProjectId: string | null = null
useProjectStore.subscribe((s) => {
  const id = s.project?.id ?? null
  if (id === openProjectId) return
  openProjectId = id
  running?.abort()
  useAgentStore.getState().reset()
})
