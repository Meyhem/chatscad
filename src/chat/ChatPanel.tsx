import { useEffect, useRef } from 'react'
import { useImageDropAndPaste } from '../images/useImageDropAndPaste'
import { useVisionSupport } from '../refine/useVisionSupport'
import { useProvidersStore } from '../settings/providersStore'
import { useAppStore } from '../state/store'
import { IconInfo, IconSpinner } from '../ui/icons'
import { selectChatCost, useChatStore } from './chatStore'
import { ProjectCostCaption } from './ProjectCostCaption'
import { Composer } from './Composer'
import { MessageView } from './MessageView'
import { goBack, stopTurn } from './sendPrompt'

export const SUGGESTIONS = [
  'A wall hook for a 30 mm broom handle',
  'A box for 18650 cells with a sliding lid',
  'A 40 mm knob for a 6 mm D-shaft',
]

function FirstRunCallout({ onAddProvider, onEditByHand }: { onAddProvider(): void; onEditByHand(): void }) {
  return (
    <div className="pc-callout is-info">
      <IconInfo className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>Connect an AI model to start</strong>
        Bring your own key for Anthropic, OpenAI, OpenRouter or any OpenAI-compatible endpoint, or point at Ollama on this computer.
        Keys stay on this device.
        <div className="pc-row mt-3">
          <button type="button" className="pc-btn is-sm is-primary" onClick={onAddProvider}>
            Add a provider
          </button>
          <button type="button" className="pc-btn is-sm is-ghost" onClick={onEditByHand}>
            Edit code by hand
          </button>
        </div>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages)
  const fixing = useChatStore((s) => s.fixing)
  const backTo = useChatStore((s) => s.backTo)
  const busy = useChatStore((s) => s.busy)
  const setDraft = useChatStore((s) => s.setDraft)
  const cost = useChatStore(selectChatCost)
  const loaded = useProvidersStore((s) => s.loaded)
  const hasProfile = useProvidersStore((s) => s.profiles.length > 0)
  const setView = useAppStore((s) => s.setView)
  const goToLine = useAppStore((s) => s.goToLine)
  const appStatus = useAppStore((s) => s.status)
  const codeSource = useAppStore((s) => s.codeSource)
  const scrollRef = useRef<HTMLDivElement>(null)
  const column = useRef<HTMLElement>(null)
  useImageDropAndPaste(column, useVisionSupport())

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, fixing])

  // findLast needs lib ES2023; tsconfig targets ES2022.
  const lastReply = [...messages].reverse().find((m) => m.role === 'assistant')
  // After Stop auto-fix or a failed fix request the last bubble has no compile status, but the editor
  // still holds the AI's failing code, so "Back to" must stay.
  const aiCodeFails = appStatus === 'error' && (codeSource === 'ai' || codeSource === 'autofix')
  const showBack = backTo !== null && (fixing !== null || (!busy && (lastReply?.compileStatus === 'error' || aiCodeFails)))

  return (
    <section ref={column} aria-label="Chat" className="flex min-h-0 min-w-0 flex-col border-b border-line bg-panel md:border-b-0">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="pc-label">Chat</span>
        <span className="flex-1" />
        {cost !== undefined && (
          <ProjectCostCaption />
        )}
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="chat-scroll">
        {loaded && !hasProfile && <FirstRunCallout onAddProvider={() => setView('settings')} onEditByHand={() => goToLine(1)} />}
        {messages.length === 0 && (
          <div className="pc-stack">
            <span className="pc-label">Try asking for</span>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="pc-btn is-sm justify-start" onClick={() => setDraft(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} />
        ))}
        {fixing && (
          <div className="pc-row pc-caption" data-testid="autofix">
            <span className="pc-status is-busy">
              <IconSpinner className="pc-i" aria-hidden="true" />
              Auto-fix {fixing.attempt} of {fixing.of}
            </span>
            Sending the error back to {fixing.model}…
          </div>
        )}
        {(fixing || showBack) && (
          <div className="pc-row">
            {fixing && (
              <button type="button" className="pc-btn is-sm is-ghost" onClick={stopTurn}>
                Stop auto-fix
              </button>
            )}
            {showBack && backTo && (
              <button type="button" className="pc-btn is-sm is-ghost" onClick={goBack}>
                {backTo.label ? `Back to ${backTo.label}` : 'Back to previous code'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <Composer />
      </div>
    </section>
  )
}
