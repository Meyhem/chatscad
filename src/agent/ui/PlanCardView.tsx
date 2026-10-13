import { useState } from 'react'
import { formatCost, formatTokens } from '../../ui/format'
import { IconChecks, IconSend, IconPlus, IconSpinner, IconWarning, IconX } from '../../ui/icons'
import { useAgentStore, type PlanCard } from '../agentStore'
import { CHECK_KIND_LABEL, CHECK_KINDS, MAX_CHECK_CHARS, MAX_CHECKS, newCheck, type Check, type CheckKind } from '../checks'

function StatusPill({ card }: { card: PlanCard }) {
  switch (card.status) {
    case 'planning':
      return (
        <span className="pc-status is-busy">
          <IconSpinner className="pc-i motion-safe:animate-spin" aria-hidden="true" />
          Planning…
        </span>
      )
    case 'ready':
      return <span className="pc-status">Waiting for you</span>
    case 'approved':
      return <span className="pc-status is-ok">Approved</span>
    case 'skipped':
      return <span className="pc-status">Skipped</span>
    case 'stopped':
      return <span className="pc-status">Stopped</span>
    case 'error':
      return <span className="pc-status is-error">Failed</span>
  }
}

export function ChecksEditor({ checks, onChange }: { checks: Check[]; onChange(checks: Check[]): void }) {
  const update = (id: string, change: Partial<Check>) => onChange(checks.map((c) => (c.id === id ? { ...c, ...change } : c)))
  return (
    <div className="pc-stack" style={{ gap: 6 }}>
      {checks.map((c, i) => (
        <div key={c.id} className="grid items-center gap-2" style={{ gridTemplateColumns: '92px minmax(0, 1fr) 28px' }}>
          <select
            className="pc-select"
            style={{ height: 32, fontSize: 13 }}
            aria-label={`Kind of check ${i + 1}`}
            value={c.kind}
            onChange={(e) => update(c.id, { kind: e.target.value as CheckKind })}
          >
            {CHECK_KINDS.map((k) => (
              <option key={k} value={k}>
                {CHECK_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <div className="pc-input" style={{ height: 32 }}>
            <input aria-label={`Check ${i + 1}`} maxLength={MAX_CHECK_CHARS} value={c.text} onChange={(e) => update(c.id, { text: e.target.value })} />
          </div>
          <button type="button" className="pc-btn is-icon is-sm is-ghost" aria-label={`Remove check ${i + 1}`} onClick={() => onChange(checks.filter((x) => x.id !== c.id))}>
            <IconX className="pc-i" aria-hidden="true" />
          </button>
        </div>
      ))}
      {checks.length < MAX_CHECKS && (
        <button type="button" className="pc-btn is-sm is-ghost self-start" onClick={() => onChange([...checks, newCheck('other', '')])}>
          <IconPlus className="pc-i" aria-hidden="true" />
          Add a check
        </button>
      )}
    </div>
  )
}

export function PlanCardView({ card }: { card: PlanCard }) {
  const approve = useAgentStore((s) => s.approvePlan)
  const skip = useAgentStore((s) => s.skipPlan)
  const setChecks = useAgentStore((s) => s.setPlanChecks)
  const [draft, setDraft] = useState<Check[] | null>(null)
  const ready = card.status === 'ready'
  const editing = ready && draft !== null

  return (
    <div className="pc-agent-card" data-testid="plan-card">
      <div className="pc-agent-card-head">
        <IconChecks className="pc-i" aria-hidden="true" />
        <span className="font-semibold">Plan{card.checks.length > 0 ? ` · ${card.checks.length} ${card.checks.length === 1 ? 'check' : 'checks'}` : ''}</span>
        <span className="flex-1" />
        <StatusPill card={card} />
      </div>
      {card.error ? (
        <div className="pc-callout is-error" role="alert">
          <IconWarning className="pc-i" aria-hidden="true" />
          <div className="pc-callout-body">
            <strong>{card.error.title}</strong>
            {card.error.body}
          </div>
        </div>
      ) : (
        card.checks.length > 0 && (
          <>
            {ready && <span className="pc-caption">Every review judges the model against these checks. You can change them now or later from Checks.</span>}
            {editing ? (
              <ChecksEditor checks={draft} onChange={setDraft} />
            ) : (
              <ol className="pc-stack m-0 list-none p-0" style={{ gap: 6 }} aria-label="Checks">
                {card.checks.map((c, i) => (
                  <li key={c.id} className="pc-plan-row">
                    <span className="pc-caption pc-mono">{i + 1}</span>
                    <span className="pc-tag">{CHECK_KIND_LABEL[c.kind]}</span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ol>
            )}
            {card.parts.length > 0 && (
              <div className="pc-stack" style={{ gap: 4 }}>
                <span className="pc-label">Parts the builder will name</span>
                <div className="pc-row" style={{ gap: 6 }}>
                  {card.parts.map((p) => (
                    <span key={p} className="pc-chip">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      )}
      {ready && (
        <div className="pc-row">
          {editing ? (
            <>
              <button
                type="button"
                className="pc-btn is-sm is-primary"
                onClick={() => {
                  setChecks(card.id, draft)
                  setDraft(null)
                }}
              >
                Done
              </button>
              <button type="button" className="pc-btn is-sm" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="pc-btn is-sm is-primary" onClick={() => void approve(card.id)}>
                <IconSend className="pc-i" aria-hidden="true" />
                {card.then === 'build' ? 'Approve and build' : 'Approve and review'}
              </button>
              <button type="button" className="pc-btn is-sm" onClick={() => setDraft(card.checks)}>
                Edit checks
              </button>
              <span className="flex-1" />
              <button type="button" className="pc-btn is-sm is-ghost" onClick={() => void skip(card.id)}>
                {card.then === 'build' ? 'Skip plan' : 'Cancel'}
              </button>
            </>
          )}
        </div>
      )}
      {card.usage && (
        <span className="pc-caption">
          Planned by {card.model} · <span className="pc-mono">{formatTokens(card.usage.inputTokens + card.usage.outputTokens)} · {formatCost(card.usage.cost)}</span>
        </span>
      )}
    </div>
  )
}
