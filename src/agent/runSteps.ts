import type { ChatMessage } from '../chat/chatStore'
import type { AgentCard } from './agentStore'

export type RunItem = { kind: 'message'; message: ChatMessage } | { kind: 'run'; runId: string; messages: ChatMessage[] }

/** Consecutive messages of one agent run become one item; edits stay single messages. */
export function groupRuns(messages: ChatMessage[]): RunItem[] {
  const items: RunItem[] = []
  for (const message of messages) {
    const last = items.at(-1)
    if (message.runId === undefined) items.push({ kind: 'message', message })
    else if (last?.kind === 'run' && last.runId === message.runId) last.messages.push(message)
    else items.push({ kind: 'run', runId: message.runId, messages: [message] })
  }
  return items
}

export interface RunStep {
  id: string
  label: string
  /** 'wait': the run waits for the user (a plan to approve, fixes to pick); 'off': skipped or out of date. */
  state: 'done' | 'fail' | 'active' | 'wait' | 'off'
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function cardStep(id: string, card: AgentCard): RunStep {
  if (card.kind === 'plan') {
    const label = `Plan · ${plural(card.checks.length, 'check')}`
    switch (card.status) {
      case 'planning':
        return { id, label: 'Plan', state: 'active' }
      case 'ready':
        return { id, label, state: 'wait' }
      case 'approved':
        return { id, label, state: 'done' }
      case 'error':
        return { id, label: 'Plan · failed', state: 'fail' }
      case 'stopped':
        return { id, label: 'Plan · stopped', state: 'fail' }
      default:
        return { id, label: card.status === 'skipped' ? 'Plan skipped' : label, state: 'off' }
    }
  }
  const head = `Review ${card.round}`
  if (card.status === 'reviewing') return { id, label: head, state: 'active' }
  if (card.status === 'error') return { id, label: `${head} · failed`, state: 'fail' }
  if (card.status === 'stopped') return { id, label: `${head} · stopped`, state: 'fail' }
  const verdicts = card.review?.verdicts ?? []
  const failed = verdicts.filter((v) => v.status === 'fail').length
  const unclear = verdicts.filter((v) => v.status === 'unclear').length
  const label = failed > 0 ? `${head} · ${failed} fail` : unclear > 0 ? `${head} · ${unclear} unclear` : `${head} · pass`
  if (card.status === 'superseded') return { id, label, state: 'off' }
  if (card.status === 'ready') return { id, label, state: failed + unclear > 0 ? 'fail' : 'wait' }
  return { id, label, state: failed + unclear > 0 ? 'fail' : 'done' }
}

/** The steps of one run: its plan, the build, each review and each fix. */
export function runSteps(messages: ChatMessage[], cards: Record<string, AgentCard>): RunStep[] {
  const steps: RunStep[] = []
  let builds = 0
  for (const m of messages) {
    if (m.role === 'assistant') {
      const label = `${builds++ === 0 ? 'Build' : 'Fix'}${m.turnLabel ? ` ${m.turnLabel}` : ''}`
      const state = m.status === 'streaming' ? 'active' : m.status === 'error' || m.compileStatus === 'error' ? 'fail' : 'done'
      steps.push({ id: m.id, label, state })
    } else if (m.role === 'note') {
      const card = m.cardId ? cards[m.cardId] : undefined
      if (card) steps.push(cardStep(m.id, card))
      // Without its card (a reloaded project), a plan or review note keeps its summary.
      else if (/^(Plan|Review)\b/.test(m.text)) steps.push({ id: m.id, label: m.text, state: /fail|stopped/.test(m.text) ? 'fail' : 'done' })
    }
  }
  return steps
}
