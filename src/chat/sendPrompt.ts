import { computeCost, priceFor } from '../ai/cost'
import { effortFor } from '../ai/effort'
import { currentLibraries } from '../history/projectStore'
import { createProvider as defaultCreateProvider } from '../ai/createProvider'
import { describeProviderError } from '../ai/errors'
import { runTurn, type GenerateResult, type TurnEvent } from '../ai/runTurn'
import type { LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import { addUsage } from '../db/usage'
import { calloutHeadline } from '../editor/diagnosticsExtension'
import { getVisualCheck, recordVisualCheckUsage } from '../db/visualCheck'
import { useAttachments } from '../images/attachments'
import { useRefineStore } from '../refine/refineStore'
import { maybeVisualCheck, type renderIsoImage } from '../refine/visualCheck'
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
  /** The dictated transcript behind this prompt, kept on the user message. */
  audioTranscript?: string | null
  /** M5: how images are stored, encoded and captured; the browser's by default. */
  turnInput?: TurnInputDeps
  /** M5: the image the visual check sends; one offscreen iso frame by default. */
  visualCheckImage?: typeof renderIsoImage
}

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

export async function sendPrompt(text: string, deps: SendDeps = {}): Promise<void> {
  const userText = text.trim()
  const chat = useChatStore.getState()
  const providers = useProvidersStore.getState()
  const profile = selectActiveProfile(providers)
  const model = selectActiveModel(providers)
  if (userText === '' || chat.busy || !profile || !model) return

  // M5: images, sketches and the picked part travel with the prompt.
  useChatStore.setState({ busy: true })
  let input: TurnInput
  try {
    input = await prepareTurnInput(
      { text: userText, attachments: useAttachments.getState().items, pick: useRefineStore.getState().pick, vision: profile.capabilities.vision },
      deps.turnInput,
    )
  } catch (err) {
    useAttachments.getState().setError(errorMessage(err))
    useChatStore.setState({ busy: false })
    return
  }
  useAttachments.getState().clear()
  // M5: read the setting once per turn, and create the provider once, for the turn and its visual check.
  const visualCheck = await getVisualCheck()
  const provider = (deps.createProvider ?? defaultCreateProvider)(profile)
  let checked = false
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

  chat.addMessage({
    role: 'user',
    text: userText,
    turnLabel: null,
    model: null,
    usage: null,
    status: 'done',
    ...(deps.audioTranscript ? { audioTranscript: deps.audioTranscript } : {}),
    ...(input.imageBlobIds.length > 0 ? { imageBlobIds: input.imageBlobIds } : {}),
  })
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
        if (e.result.ok && !checked) {
          checked = true
          void maybeVisualCheck({
            enabled: visualCheck,
            vision: profile.capabilities.vision,
            provider,
            model,
            request: userText,
            mesh: e.result.mesh,
            price: profile.priceTable[model],
            signal: controller.signal,
            renderImage: deps.visualCheckImage,
            addNote: (n) => useChatStore.getState().addMessage(n),
            onUsage: (usage) => void recordVisualCheckUsage({ profile, model, usage }).catch(() => {}),
          })
        }
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
      userText: input.userText,
      // A selection's line numbers refer to the real code, even when it is the sample.
      ctx: {
        code: isEmptyCode(startCode) && !input.selection ? '' : startCode,
        libraries: currentLibraries(),
        ...(input.selection ? { selection: input.selection } : {}),
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
