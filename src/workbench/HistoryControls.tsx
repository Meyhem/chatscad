import { useProjectStore } from '../history/projectStore'
import { IconRedo, IconUndo } from '../ui/icons'

export function HistoryControls() {
  const canUndo = useProjectStore((s) => Boolean(s.head?.parentId))
  const canRedo = useProjectStore((s) => s.redoStack.length > 0)
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
    </div>
  )
}
