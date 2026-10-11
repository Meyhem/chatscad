import { computeCost, priceFor } from '../ai/cost'
import { currentLibraries } from '../history/projectStore'
import { createProvider as defaultCreateProvider } from '../ai/createProvider'
import { describeProviderError } from '../ai/errors'
import { runTurn, type TurnEvent } from '../ai/runTurn'
import type { LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import { addUsage } from '../db/usage'
import { calloutHeadline } from '../editor/diagnosticsExtension'
import { awaitRender } from '../render/awaitRender'
import type { RenderResult } from '../render/types'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { DEFAULT_CODE, useAppStore } from '../state/store'
import { useChatStore, type ChatMessage } from './chatStore'
import { streamingText } from './streamingText'

export interface SendDeps {
  createProvider?(profile: ProviderProfile): LlmProvider
  render?(code: string, signal: AbortSignal): Promise<RenderResult>
  /** The dictated transcript behind this prompt, kept on the user message. */
  audioTranscript?: string | null
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

export async function sendPrompt(text: string, deps: SendDeps = {}): Promise<void> {
  const userText = text.trim()
  const chat = useChatStore.getState()
  const providers = useProvidersStore.getState()
  const profile = selectActiveProfile(providers)
  const model = selectActiveModel(providers)
  if (userText === '' || chat.busy || !profile || !model) return

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
      case 'reply': {
        const { result } = e
        const { cost, costSource } = computeCost(result.usage, priceFor(profile, result.model))
        const label = result.code !== null ? store.nextLabel(result.code) : null
        store.patchMessage(current, {
          text: result.prose || (result.code !== null ? 'Updated main.scad.' : 'The reply had no code.'),
          status: 'done',
          turnLabel: label,
          model: result.model,
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cost },
        })
        if (e.attempt === 0) {
          useChatStore.setState((s) => ({
            history: [...s.history, { role: 'user', content: userText }, { role: 'assistant', content: result.prose || 'Updated main.scad.' }],
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
    await runTurn({
      provider: (deps.createProvider ?? defaultCreateProvider)(profile),
      model,
      history: chat.history,
      userText,
      ctx: { code: startCode === DEFAULT_CODE ? '' : startCode, libraries: currentLibraries() },
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
