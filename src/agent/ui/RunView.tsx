import { useState } from 'react'
import type { ChatMessage } from '../../chat/chatStore'
import { MessageView } from '../../chat/MessageView'
import { IconAgent, IconCheck, IconClock, IconSpinner, IconX } from '../../ui/icons'
import { useAgentStore } from '../agentStore'
import { runSteps, type RunStep } from '../runSteps'

function StepIcon({ state }: { state: RunStep['state'] }) {
  if (state === 'done') return <IconCheck className="pc-i" aria-hidden="true" />
  if (state === 'fail') return <IconX className="pc-i" aria-hidden="true" />
  if (state === 'active') return <IconSpinner className="pc-i motion-safe:animate-spin" aria-hidden="true" />
  if (state === 'wait') return <IconClock className="pc-i" aria-hidden="true" />
  return null
}

const STATE_LABEL: Record<RunStep['state'], string> = { done: 'done', fail: 'failed', active: 'running', wait: 'waiting for you', off: 'not used' }

/** One agent run: a header with its latest step, the steps so far, and its messages. Older runs start folded. */
export function RunView({ messages, latest }: { messages: ChatMessage[]; latest: boolean }) {
  const [open, setOpen] = useState(latest)
  const cards = useAgentStore((s) => s.cards)
  const steps = runSteps(messages, cards)
  const last = steps.at(-1)
  const caption = last ? (last.state === 'wait' ? `${last.label} · waiting for you` : last.label) : 'Starting…'

  return (
    <section aria-label="Agent run" className={`pc-run${open ? '' : ' is-folded'}`} data-testid="agent-run">
      <div className="pc-run-head">
        <IconAgent className="pc-i" aria-hidden="true" />
        <span className="font-semibold">Agent run</span>
        <span className="pc-caption min-w-0 truncate">{caption}</span>
        <span className="flex-1" />
        <button type="button" className="pc-btn is-sm is-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <>
          {steps.length > 0 && (
            <ol className="pc-steps" aria-label="Steps">
              {steps.map((s) => (
                <li key={s.id} className={`is-${s.state}`} aria-label={`${s.label}, ${STATE_LABEL[s.state]}`}>
                  <StepIcon state={s.state} />
                  {s.label}
                </li>
              ))}
            </ol>
          )}
          {messages.map((m) => (
            <MessageView key={m.id} message={m} />
          ))}
        </>
      )}
    </section>
  )
}
