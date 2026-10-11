import { useProjectStore } from '../history/projectStore'
import { useAppStore } from '../state/store'
import { IconHistory, IconRedo, IconUndo } from '../ui/icons'

export function HistoryControls() {
  const view = useAppStore((s) => s.view)
  const canUndo = useProjectStore((s) => Boolean(s.head?.parentId))
  const canRedo = useProjectStore((s) => s.redoStack.length > 0)
  const inHistory = view === 'history'
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="pc-btn is-ghost is-sm is-icon"
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={() => void useProjectStore.getState().undo()}
      >
        <IconUndo className="pc-i" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pc-btn is-ghost is-sm is-icon"
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={() => void useProjectStore.getState().redo()}
      >
        <IconRedo className="pc-i" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`pc-btn is-sm ${inHistory ? 'border-accent' : 'is-ghost'}`}
        aria-pressed={inHistory}
        onClick={() => useAppStore.getState().setView(inHistory ? 'workbench' : 'history')}
      >
        <IconHistory className="pc-i" aria-hidden="true" />
        History
      </button>
    </div>
  )
}
