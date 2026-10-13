import { IconPalette } from '../../ui/icons'
import { useAgentStore } from '../agentStore'

/** Viewer button: paint each top-level part in the colour the reviewer sees. */
export function PartColoursToggle({ available }: { available: boolean }) {
  const on = useAgentStore((s) => s.partColours)
  const setOn = useAgentStore((s) => s.setPartColours)
  return (
    <button
      type="button"
      aria-label="Part colours"
      aria-pressed={available && on}
      title={available ? 'Part colours: what the reviewer sees' : 'Part colours show once the parts of a rendered model are found'}
      disabled={!available}
      className={`grid size-(--control-sm) place-items-center rounded-sm border bg-panel hover:text-ink disabled:text-ink-disabled pointer-coarse:size-(--touch-target) ${
        available && on ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-muted'
      }`}
      onClick={() => setOn(!on)}
    >
      <IconPalette className="pc-i" aria-hidden="true" />
    </button>
  )
}
