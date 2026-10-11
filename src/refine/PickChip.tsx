import { formatDims } from '../render/dims'
import { formatLines } from '../scad/statements'
import { IconPart, IconX } from '../ui/icons'
import { useRefineStore } from './refineStore'

/** Refine screen: the composer's scope chip. */
export function PickChip() {
  const pick = useRefineStore((s) => s.pick)
  const setPick = useRefineStore((s) => s.setPick)
  if (!pick) return null
  const label =
    pick.kind === 'part' ? `${pick.statement.label} · ${formatLines(pick.scope)}` : `Selected region · ${formatDims(pick.bounds)}`
  return (
    <div className="pc-row">
      <span className="pc-chip is-pick">
        <IconPart className="pc-i" aria-hidden="true" />
        {label}
      </span>
      <button type="button" className="pc-btn is-icon is-sm is-ghost" aria-label="Clear selected part" onClick={() => setPick(null)}>
        <IconX className="pc-i" aria-hidden="true" />
      </button>
      <span className="pc-caption">{pick.kind === 'part' ? 'Only this part will change' : 'Its position is sent with your message'}</span>
    </div>
  )
}
