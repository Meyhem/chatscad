import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconBrain, IconChevronRight } from '../ui/icons'
import type { ChatMessage } from './chatStore'

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  return lines.at(-1) ?? ''
}

/** Date.now(), refreshed every second while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])
  return now
}

function header(message: ChatMessage, streaming: boolean, now: number): string {
  if (streaming && message.reasoningStartedAt !== undefined) return `Thinking · ${formatDuration(now - message.reasoningStartedAt)}`
  if (message.reasoningMs === undefined) return 'Reasoning'
  const tokens = message.reasoningTokens !== undefined ? ` · ${message.reasoningTokens.toLocaleString('en-US')} tokens` : ''
  return `Thought for ${formatDuration(message.reasoningMs)}${tokens}`
}

/** Full reasoning; follows new text while streaming unless the user scrolled up. */
function ReasoningBody({ text, follow }: { text: string; follow: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight
  }, [text, follow])
  return (
    <div
      ref={ref}
      className="pc-reasoning-body"
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
      }}
    >
      {text}
    </div>
  )
}

/** The model's reasoning, collapsed. Model output: text nodes only. */
export function ReasoningBox({ message }: { message: ChatMessage }) {
  const streaming = message.status === 'streaming'
  const [open, setOpen] = useState(false)
  const now = useNow(streaming)
  const reasoning = message.reasoning ?? ''
  if (reasoning === '') return null
  return (
    <div className="pc-reasoning">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <IconChevronRight className="pc-i pc-reasoning-chevron" aria-hidden="true" />
          <IconBrain className="pc-i" aria-hidden="true" />
          {header(message, streaming, now)}
        </summary>
        <ReasoningBody text={reasoning} follow={streaming} />
      </details>
      {streaming && !open && (
        <div className="pc-reasoning-live pc-shimmer" aria-hidden="true">
          {lastLine(reasoning)}
        </div>
      )}
    </div>
  )
}
