import { useState } from 'react'
import { useProjectStore } from '../../history/projectStore'
import { Popover } from '../../ui/Popover'
import { IconCheck, IconChecks, IconWarning } from '../../ui/icons'
import { useAgentStore, type ReviewCard } from '../agentStore'
import { cleanChecks, NO_CHECKS, type Check } from '../checks'
import { ChecksEditor } from './PlanCardView'

/** The latest finished review of the current checks: how many pass. */
function useCheckState(checks: readonly Check[]): { passed: number; total: number } | null {
  const cards = useAgentStore((s) => s.cards)
  const latest = Object.values(cards)
    .filter((c): c is ReviewCard => c.kind === 'review' && c.review !== null)
    .at(-1)
  if (!latest?.review) return null
  const ids = new Set(checks.map((c) => c.id))
  const verdicts = latest.review.verdicts.filter((v) => ids.has(v.checkId))
  if (verdicts.length !== checks.length) return null
  return { passed: verdicts.filter((v) => v.status === 'pass').length, total: checks.length }
}

function Editor({ checks, close }: { checks: readonly Check[]; close(): void }) {
  const [draft, setDraft] = useState<Check[]>([...checks])
  return (
    <>
      <div className="pc-row">
        <span className="font-semibold">Checks</span>
        <span className="flex-1" />
        <span className="pc-caption">Every review judges the model against these.</span>
      </div>
      <ChecksEditor checks={draft} onChange={setDraft} />
      <div className="pc-row justify-end">
        <button type="button" className="pc-btn is-sm" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="pc-btn is-sm is-primary"
          onClick={() => {
            void useProjectStore.getState().setChecks(cleanChecks(draft))
            close()
          }}
        >
          Save
        </button>
      </div>
    </>
  )
}

export function ChecksButton() {
  const checks = useProjectStore((s) => s.project?.checks ?? NO_CHECKS)
  const state = useCheckState(checks)
  const label =
    checks.length === 0 ? 'No checks' : state ? `Checks · ${state.passed} of ${state.total} pass` : `Checks · ${checks.length}`
  const Icon = state ? (state.passed === state.total ? IconCheck : IconWarning) : IconChecks
  const tone = state ? (state.passed === state.total ? 'text-ok' : 'text-warn') : 'text-ink-muted'
  return (
    <Popover
      label="Checks"
      className="right-0 top-9 w-[440px] max-w-[calc(100vw-24px)]"
      trigger={(props) => (
        <button type="button" className="pc-btn is-sm is-ghost" {...props}>
          <Icon className={`pc-i ${tone}`} aria-hidden="true" />
          {label}
        </button>
      )}
    >
      {(close) => <Editor checks={checks} close={close} />}
    </Popover>
  )
}
