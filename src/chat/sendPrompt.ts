import { computeCost, priceFor } from '../ai/cost'
import { effortFor } from '../ai/effort'
import { currentLibraries, useProjectStore } from '../history/projectStore'
import { createProvider as defaultCreateProvider } from '../ai/createProvider'
import { describeProviderError } from '../ai/errors'
import { runTurn, type GenerateResult, type TurnEvent } from '../ai/runTurn'
import type { PromptContext } from '../ai/prompt'
import type { ContentPart, LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import { addUsage } from '../db/usage'
import { calloutHeadline } from '../editor/diagnosticsExtension'
import { useAttachments } from '../images/attachments'
import { loadPhotos as defaultLoadPhotos, photoParts } from '../photos/projectPhotos'
import { useRefineStore } from '../refine/refineStore'
import { prepareTurnInput, type TurnInput, type TurnInputDeps } from '../refine/turnInput'
import { awaitRender } from '../render/awaitRender'
import { errorMessage } from '../render/result'
import type { RenderResult } from '../render/types'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { isEmptyCode, useAppStore } from '../state/store'
import { useChatStore, type ChatMessage } from './chatStore'
import { streamingText } from './streamingText'

export interface SendDeps {
  createProvider?(profile: ProviderProfile): LlmProvider
  render?(code: string, signal: AbortSignal): Promise<RenderResult>
  /** Agent: what the user bubble shows when the model gets a longer text (checks, review fixes). */
  displayText?: string
  /** The dictated transcript behind this prompt, kept on the user message. */
  audioTranscript?: string | null
  /** M5: how images are stored, encoded and captured; the browser's by default. */
  turnInput?: TurnInputDeps
  /** Spec P4: the user bubble shows the project's photos (the first request of a photo project). */
  showPhotos?: boolean
  /** How the project's photos are read; the database by default. */
  loadPhotos?: typeof defaultLoadPhotos
}

/** How a turn ended, for the agent: whether it reviews the result (spec A3). */
export interface TurnOutcome {
  /** False when nothing was sent (empty text, busy, no provider, unreadable attachments). */
  sent: boolean
  /** The editor held no code when the request was sent: a new model. */
  startedEmpty: boolean
  /** The last render of the turn's code; null when no code was applied. */
  rendered: RenderResult | null
  /** The turn was stopped (by Stop, an edit or a parameter change). */
  stopped: boolean
}

const NOT_SENT: TurnOutcome = { sent: false, startedEmpty: false, rendered: null, stopped: false }

let inFlight: AbortController | null = null

export function stopTurn(): void {
  inFlight?.abort()
}

const note = (text: string): Omit<ChatMessage, 'id'> => ({ role: 'note', text, turnLabel: null, model: null, usage: null, status: 'done' })

/** The chat callout for a failed render: the first error line in the editor's words, then OpenSCAD's summary. */
export function compileErrorCallout(result: RenderResult): { title: string; body: string } | undefined {
  if (result.ok) return undefined
  const first = result.diagnostics.find((d) => d.severity === 'error')
  return { title: first ? calloutHeadline(first) : 'The code did not compile', body: result.error }
}

/** The callout for a reply that hit the provider's output limit before it wrote any code. */
export function cutOffCallout(result: GenerateResult): { title: string; body: string } | undefined {
  if (result.stopReason !== 'length' || result.code !== null) return undefined
  const n = result.usage.outputTokens.toLocaleString('en-US')
  return {
    title: 'The reply was cut off before it wrote any code',
    body:
      result.reasoning !== ''
        ? `The model used its whole output allowance (${n} tokens) on reasoning. Try a lower effort or another model.`
        : `The model reached its output limit (${n} tokens).`,
  }
}

export async function sendPrompt(text: string, deps: SendDeps = {}): Promise<TurnOutcome> {
  const userText = text.trim()
  const chat = useChatStore.getState()
  const providers = useProvidersStore.getState()
  const profile = selectActiveProfile(providers)
  const model = selectActiveModel(providers)
  if (userText === '' || chat.busy || !profile || !model) return NOT_SENT

  // M5: images, sketches and the picked part travel with the prompt.
  useChatStore.setState({ busy: true })
  let input: TurnInput
  // Spec P6: a photo project's reference photos go with every request.
  const project = useProjectStore.getState().project
  const photos = project?.photos ?? []
  let modelText: TurnInput['userText']
  let photoCtx: PromptContext['photos'] | undefined
  let missingPhotos = 0
  try {
    input = await prepareTurnInput(
      { text: userText, attachments: useAttachments.getState().items, pick: useRefineStore.getState().pick, vision: profile.capabilities.vision },
      deps.turnInput,
    )
    modelText = input.userText
    if (photos.length > 0) {
      const { loaded, missing } = await (deps.loadPhotos ?? defaultLoadPhotos)(photos)
      missingPhotos = missing
      if (loaded.length > 0) {
        const parts = await photoParts(loaded, deps.turnInput?.toBase64)
        const head: ContentPart[] = typeof modelText === 'string' ? [{ type: 'text', text: modelText }] : modelText
        modelText = [...head, ...parts]
        photoCtx = { angles: loaded.map((l) => l.photo.angle), scale: project?.scale ?? 'reference' }
      }
    }
  } catch (err) {
    useAttachments.getState().setError(errorMessage(err))
    useChatStore.setState({ busy: false })
    return NOT_SENT
  }
  useAttachments.getState().clear()
  const provider = (deps.createProvider ?? defaultCreateProvider)(profile)
  let rendered: RenderResult | null = null
  const notices = new Set<string>()

  const startCode = useAppStore.getState().code
  const controller = new AbortController()
  inFlight = controller
  let stoppedBy: 'edit' | 'param' | null = null
  const unsubscribe = useAppStore.subscribe((s, prev) => {
    if (s.code !== prev.code && s.codeSource === 'manual') {
      stoppedBy = 'edit'
      controller.abort()
    } else if (s.params !== prev.params && s.code === prev.code) {
      // A slider render would stand in for the turn's own render of the model's defaults.
      stoppedBy = 'param'
      controller.abort()
    }
  })

  const shownImages = [...input.imageBlobIds, ...(deps.showPhotos ? photos.map((p) => p.blobId) : [])]
  chat.addMessage({
    role: 'user',
    text: deps.displayText?.trim() || userText,
    turnLabel: null,
    model: null,
    usage: null,
    status: 'done',
    ...(deps.audioTranscript ? { audioTranscript: deps.audioTranscript } : {}),
    ...(shownImages.length > 0 ? { imageBlobIds: shownImages } : {}),
  })
  if (missingPhotos > 0) chat.addMessage(note(`${missingPhotos} ${missingPhotos === 1 ? 'photo' : 'photos'} could not be loaded`))
  const openReply = () => chat.addMessage({ role: 'assistant', text: '', turnLabel: null, model, usage: null, status: 'streaming' })
  let current = openReply()
  useChatStore.setState({ busy: true, fixing: null, draft: '', backTo: { label: chat.labelForCode(startCode), code: startCode } })

  const onEvent = (e: TurnEvent) => {
    const store = useChatStore.getState()
    switch (e.type) {
      case 'delta':
        store.appendText(current, e.text)
        return
      case 'reasoning':
        store.appendReasoning(current, e.text)
        return
      case 'notice':
        if (!notices.has(e.text)) {
          notices.add(e.text)
          store.addMessage(note(e.text))
        }
        return
      case 'retry':
        store.patchMessage(current, { text: '', reasoning: undefined, reasoningStartedAt: undefined })
        return
      case 'reply': {
        const { result } = e
        const { cost, costSource } = computeCost(result.usage, priceFor(profile, result.model))
        const label = result.code !== null ? store.nextLabel(result.code) : null
        const cutOff = cutOffCallout(result)
        store.patchMessage(current, {
          text: result.prose || (result.code !== null ? 'Updated main.scad.' : cutOff ? '' : 'The reply had no code.'),
          status: 'done',
          turnLabel: label,
          model: result.model,
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cost },
          ...(result.reasoningMs !== null ? { reasoningMs: result.reasoningMs } : {}),
          ...(result.usage.reasoningTokens !== undefined ? { reasoningTokens: result.usage.reasoningTokens } : {}),
          ...(cutOff ? { error: cutOff } : {}),
        })
        if (e.attempt === 0) {
          useChatStore.setState((s) => ({
            // A scope rejection is the app's words, not the model's; the model only learns nothing changed.
            history: [
              ...s.history,
              { role: 'user', content: userText },
              { role: 'assistant', content: result.scopeRejected ? 'Made no change.' : result.prose || 'Updated main.scad.' },
            ],
          }))
        }
        void addUsage({
          profileId: profile.id,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cost,
          costSource,
        }).catch(() => {
          // A usage row is bookkeeping; never fail the turn over it.
        })
        return
      }
      case 'rendered':
        store.patchMessage(current, { compileStatus: e.result.ok ? 'ok' : 'error', error: compileErrorCallout(e.result) })
        rendered = e.result
        return
      case 'fixing':
        useChatStore.setState({ fixing: { attempt: e.attempt, of: e.of, model } })
        current = openReply()
        return
      case 'gave-up':
        useChatStore.setState({ fixing: null })
        if (e.attempts > 0) {
          store.addMessage(note(`Auto-fix stopped after ${e.attempts} ${e.attempts === 1 ? 'attempt' : 'attempts'}. The code still doesn't compile.`))
        }
        return
    }
  }

  try {
    const reasoningEffort = effortFor(profile, model)
    await runTurn({
      provider,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      history: chat.history,
      userText: modelText,
      // A selection's line numbers refer to the real code, even when it is the sample.
      ctx: {
        code: isEmptyCode(startCode) && !input.selection ? '' : startCode,
        libraries: currentLibraries(),
        ...(input.selection ? { selection: input.selection } : {}),
        ...(photoCtx ? { photos: photoCtx } : {}),
        ...(photos.length > 0 && Object.keys(useAppStore.getState().params).length > 0 ? { keepParams: useAppStore.getState().params } : {}),
      },
      maxFixAttempts: providers.settings.autoFixAttempts,
      render: deps.render ?? awaitRender,
      apply: (code, source) => useAppStore.getState().setCode(code, source),
      onEvent,
      signal: controller.signal,
    })
  } catch (err) {
    const store = useChatStore.getState()
    const message = store.messages.find((m) => m.id === current)
    if (controller.signal.aborted) {
      if (message?.status === 'streaming') {
        store.patchMessage(current, { status: 'done', text: streamingText(message.text).prose || 'Stopped before the reply finished.' })
      }
      store.addMessage(
        note(stoppedBy === 'edit' ? 'Stopped: you edited the code.' : stoppedBy === 'param' ? 'Stopped: you changed a parameter.' : 'Stopped.'),
      )
    } else {
      store.patchMessage(current, { status: 'error', text: '', error: describeProviderError(err, profile.baseUrl) })
    }
  } finally {
    unsubscribe()
    if (inFlight === controller) inFlight = null
    useChatStore.setState({ busy: false, fixing: null })
  }
  return { sent: true, startedEmpty: isEmptyCode(startCode), rendered, stopped: controller.signal.aborted }
}

/** "Back to vN": stops any running turn and restores the code from before it. */
export function goBack(): void {
  const { backTo, addMessage } = useChatStore.getState()
  if (!backTo) return
  stopTurn()
  useAppStore.getState().setCode(backTo.code, 'restore')
  addMessage(note(`Went back to ${backTo.label ?? 'the code from before this prompt'}.`))
  useChatStore.setState({ backTo: null })
}
