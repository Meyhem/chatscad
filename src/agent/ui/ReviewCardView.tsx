import { useProjectStore } from '../../history/projectStore'
import { formatCost, formatTokens } from '../../ui/format'
import { IconAutofix, IconCheck, IconChevronRight, IconEye, IconSpinner, IconStop, IconUnclear, IconWarning, IconX } from '../../ui/icons'
import { useAgentStore, type ReviewCard } from '../agentStore'
import { CHECK_KIND_LABEL, NO_CHECKS, type Check } from '../checks'
import type { CheckStatus, CheckVerdict, Issue, LegendEntry } from '../review'
import { Legend, Swatch } from './Legend'

const VERDICT: Record<CheckStatus, { word: string; Icon: typeof IconCheck }> = {
  pass: { word: 'Pass', Icon: IconCheck },
  fail: { word: 'Fail', Icon: IconX },
  unclear: { word: 'Unclear', Icon: IconUnclear },
}

function CheckRow({ verdict, check, n }: { verdict: CheckVerdict; check: Check | undefined; n: number }) {
  const { word, Icon } = VERDICT[verdict.status]
  return (
    <li className="pc-check">
      <span className={`pc-verdict is-${verdict.status}`}>
        <Icon className="pc-i" aria-hidden="true" />
        {word}
      </span>
      <span className="pc-stack min-w-0" style={{ gap: 0 }}>
        <span>
          {n} · {check?.text ?? 'A check that was removed'}
        </span>
        {verdict.evidence && <span className="pc-caption">{verdict.evidence}</span>}
      </span>
    </li>
  )
}

function PartChip({ part, legend }: { part: string | null; legend: LegendEntry[] }) {
  if (part === null) return null
  const entry = legend.find((l) => l.label === part)
  return (
    <span className="pc-chip">
      <Swatch token={entry?.token ?? 'part-none'} />
      {entry ? `${part} · ${entry.lines}` : `new: ${part}`}
    </span>
  )
}

const SEVERITY: Record<Issue['severity'], string> = { high: 'High', medium: 'Medium', low: 'Low' }

function headPill(card: ReviewCard, failed: number, total: number) {
  switch (card.status) {
    case 'reviewing':
      return (
        <span className="pc-status is-busy">
          <IconSpinner className="pc-i motion-safe:animate-spin" aria-hidden="true" />
          Reviewing…
        </span>
      )
    case 'passed':
      return (
        <span className="pc-status is-ok">
          <IconCheck className="pc-i" aria-hidden="true" />
          All {total} pass
        </span>
      )
    case 'error':
      return <span className="pc-status is-error">Failed</span>
    case 'stopped':
      return <span className="pc-status">Stopped</span>
    default:
      return (
        <span className={`pc-status ${failed > 0 ? 'is-warn' : 'is-ok'}`}>
          {failed > 0 ? <IconWarning className="pc-i" aria-hidden="true" /> : <IconCheck className="pc-i" aria-hidden="true" />}
          {failed > 0 ? `${failed} of ${total} fail` : `All ${total} pass`}
        </span>
      )
  }
}

export function ReviewCardView({ card }: { card: ReviewCard }) {
  const checks = useProjectStore((s) => s.project?.checks ?? NO_CHECKS)
  const toggle = useAgentStore((s) => s.toggleIssue)
  const fix = useAgentStore((s) => s.fixIssues)
  const accept = useAgentStore((s) => s.accept)
  const stop = useAgentStore((s) => s.stop)
  const addSuggested = useAgentStore((s) => s.addSuggestedChecks)
  const review = card.review
  const byId = new Map(checks.map((c, i) => [c.id, { check: c, n: i + 1 }]))
  const verdicts = review?.verdicts ?? []
  const open = verdicts.filter((v) => v.status !== 'pass')
  const passing = verdicts.filter((v) => v.status === 'pass')
  const failed = verdicts.filter((v) => v.status === 'fail').length
  const ready = card.status === 'ready'
  const selected = card.selected.length

  return (
    <div className="pc-agent-card" data-testid="review-card">
      <div className="pc-agent-card-head">
        <IconEye className="pc-i" aria-hidden="true" />
        <span className="font-semibold">
          Review · round {card.round}
          {card.versionLabel ? ` · ${card.versionLabel}` : ''}
        </span>
        <span className="flex-1" />
        {headPill(card, failed, verdicts.length)}
      </div>

      {card.frames.length > 0 && (
        <div className="pc-frames" aria-label="What the reviewer saw">
          {card.frames.map((f) => (
            <figure key={f.view}>
              <img src={f.url} alt={`${f.view} view`} />
              <figcaption>{f.view}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {review && (card.coloured ? <Legend entries={card.legend} /> : <span className="pc-caption">Parts not coloured: the reviewer saw the model in one colour.</span>)}
      {review?.summary && <span>{review.summary}</span>}

      {card.error && (
        <div className="pc-callout is-error" role="alert">
          <IconWarning className="pc-i" aria-hidden="true" />
          <div className="pc-callout-body">
            <strong>{card.error.title}</strong>
            {card.error.body}
          </div>
        </div>
      )}

      {verdicts.length > 0 && (
        <div className="pc-stack" style={{ gap: 0 }}>
          {open.length > 0 && (
            <ul className="m-0 list-none p-0" aria-label="Checks to look at">
              {open.map((v) => (
                <CheckRow key={v.checkId} verdict={v} check={byId.get(v.checkId)?.check} n={byId.get(v.checkId)?.n ?? 0} />
              ))}
            </ul>
          )}
          {passing.length > 0 && (
            <details>
              <summary className="pc-btn is-sm is-ghost mt-1 inline-flex list-none">
                <IconChevronRight className="pc-i" aria-hidden="true" />
                {open.length === 0 ? `Show the ${passing.length} passing checks` : `Show ${passing.length} passing ${passing.length === 1 ? 'check' : 'checks'}`}
              </summary>
              <ul className="m-0 list-none p-0" aria-label="Passing checks">
                {passing.map((v) => (
                  <CheckRow key={v.checkId} verdict={v} check={byId.get(v.checkId)?.check} n={byId.get(v.checkId)?.n ?? 0} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {review && review.issues.length > 0 && (
        <div className="pc-stack" style={{ gap: 6 }}>
          <div className="pc-row">
            <span className="pc-label">Fixes</span>
            <span className="flex-1" />
            <span className="pc-caption">
              {selected} of {review.issues.length} ticked
            </span>
          </div>
          {review.issues.map((issue) => {
            const check = issue.checkId ? byId.get(issue.checkId) : undefined
            return (
              <label key={issue.id} className="pc-issue">
                <input type="checkbox" checked={card.selected.includes(issue.id)} disabled={!ready} onChange={() => toggle(card.id, issue.id)} />
                <span className="pc-stack min-w-0" style={{ gap: 4 }}>
                  <span className="pc-row" style={{ gap: 6 }}>
                    <span className="pc-tag">{SEVERITY[issue.severity]}</span>
                    <PartChip part={issue.part} legend={card.legend} />
                    <span className="pc-caption">{check ? `Fixes ${check.n}` : 'Not in the checks'}</span>
                  </span>
                  <span>{issue.change}</span>
                </span>
              </label>
            )
          })}
        </div>
      )}

      {review && review.newChecks.length > 0 && (
        <div className="pc-stack" style={{ gap: 4 }}>
          <span className="pc-label">Suggested checks</span>
          <ul className="m-0 list-none p-0">
            {review.newChecks.map((c) => (
              <li key={c.id} className="pc-plan-row" style={{ gridTemplateColumns: '64px minmax(0, 1fr)' }}>
                <span className="pc-tag">{CHECK_KIND_LABEL[c.kind]}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="pc-btn is-sm self-start" disabled={card.suggestionsAdded} onClick={() => void addSuggested(card.id)}>
            {card.suggestionsAdded ? 'Added to checks' : 'Add to checks'}
          </button>
        </div>
      )}

      {card.limitReached && ready && <span className="pc-caption">Stopped after round {card.round}, the round limit. Fix more by hand, or accept it as it is.</span>}

      {(ready || card.status === 'reviewing') && (
        <div className="pc-row">
          {ready && (
            <>
              <button type="button" className="pc-btn is-sm is-primary" disabled={selected === 0} onClick={() => void fix(card.id)}>
                <IconAutofix className="pc-i" aria-hidden="true" />
                Fix {selected} {selected === 1 ? 'issue' : 'issues'}
              </button>
              <button type="button" className="pc-btn is-sm" onClick={() => accept(card.id)}>
                Accept as is
              </button>
            </>
          )}
          {card.status === 'reviewing' && (
            <button type="button" className="pc-btn is-sm is-ghost" onClick={stop}>
              <IconStop className="pc-i" aria-hidden="true" />
              Stop
            </button>
          )}
        </div>
      )}
      {card.status === 'accepted' && <span className="pc-caption">Accepted as it is.</span>}
      {card.status === 'fixed' && <span className="pc-caption">Fixes sent to the builder.</span>}

      {card.usage && (
        <span className="pc-caption">
          Reviewer {card.model} · <span className="pc-mono">{formatTokens(card.usage.inputTokens + card.usage.outputTokens)} · {formatCost(card.usage.cost)}</span>
        </span>
      )}
    </div>
  )
}
