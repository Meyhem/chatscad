import type { ReactNode } from 'react'
import { useAgentStore } from '../agent/agentStore'
import { AgentCardView } from '../agent/ui/AgentCardView'
import { MessageImages } from '../images/MessageImages'
import { formatCost, formatTokens } from '../ui/format'
import { IconManual, IconSparkle, IconSpinner, IconWarning, IconX } from '../ui/icons'
import type { ChatMessage } from './chatStore'
import { ReasoningBox } from './ReasoningBox'
import { streamingText } from './streamingText'

/** Splits `code` spans out of model text as React nodes. Never parses HTML: everything else stays a text node. */
export function inlineCode(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/g).map((part, i) =>
    part.length > 2 && part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part,
  )
}

function MetaLine({ message }: { message: ChatMessage }) {
  const failed = message.compileStatus === 'error'
  const chip = failed ? 'Failed' : message.turnLabel
  const Icon = failed ? IconX : IconSparkle
  return (
    <div className="pc-msg-meta">
      {chip && (
        <span className="pc-chip is-accent">
          <Icon className="pc-i" aria-hidden="true" />
          {chip}
        </span>
      )}
      {message.runId === undefined && (
        <span className="pc-chip" title="Sent in Edit mode: not planned or reviewed">
          <IconManual className="pc-i" aria-hidden="true" />
          Edit
        </span>
      )}
      {message.model && <span>{message.model}</span>}
      {message.usage && (
        <span className="pc-mono" data-testid="msg-cost">
          {formatTokens(message.usage.inputTokens + message.usage.outputTokens)} · {formatCost(message.usage.cost)}
        </span>
      )}
    </div>
  )
}

export function MessageView({ message }: { message: ChatMessage }) {
  const hasCard = useAgentStore((s) => message.cardId !== undefined && s.cards[message.cardId] !== undefined)
  if (message.role === 'note' && hasCard && message.cardId) return <AgentCardView cardId={message.cardId} />
  if (message.role === 'note') {
    return (
      <div className="pc-row pc-caption justify-center text-center" data-testid="chat-note">
        {message.text}
      </div>
    )
  }
  if (message.role === 'user') {
    return (
      <div className="pc-msg is-user">
        {message.imageBlobIds && message.imageBlobIds.length > 0 && <MessageImages ids={message.imageBlobIds} />}
        <div className="pc-msg-body whitespace-pre-wrap">{message.text}</div>
      </div>
    )
  }

  const streaming = message.status === 'streaming'
  const { prose, writing } = streaming ? streamingText(message.text) : { prose: message.text, writing: false }
  return (
    <div className="pc-msg is-assistant" data-testid="chat-reply">
      <ReasoningBox message={message} />
      {prose !== '' && <div className="pc-msg-body whitespace-pre-wrap">{inlineCode(prose)}</div>}
      {streaming ? (
        // Once reasoning streams, its box says the model is thinking.
        (writing || !message.reasoning) && (
          <div className="pc-row pc-caption">
            <IconSpinner className="pc-i motion-safe:animate-spin" aria-hidden="true" />
            {writing ? 'Writing code…' : 'Thinking…'}
          </div>
        )
      ) : (
        message.status === 'done' && <MetaLine message={message} />
      )}
      {message.error && (
        <div className="pc-callout is-error" role="alert">
          <IconWarning className="pc-i" aria-hidden="true" />
          <div className="pc-callout-body">
            <strong>{message.error.title}</strong>
            {message.error.body}
          </div>
        </div>
      )}
    </div>
  )
}
