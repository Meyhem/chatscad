import { useAppStore } from '../state/store'
import { IconBox } from '../ui/icons'

/** Shown over the empty grid while the editor holds no code. */
export function EmptyModelCard() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
      <div className="pointer-events-auto flex max-w-90 flex-col items-center gap-3 rounded-lg border border-line bg-panel p-6 text-center">
        <IconBox className="pc-i size-6 text-ink-muted" aria-hidden="true" />
        <h2 className="text-[16px] leading-[22px] font-semibold">Nothing to render yet</h2>
        <p className="pc-muted">Describe a part in the chat, write OpenSCAD in the editor, or start from an example.</p>
        <button type="button" className="pc-btn is-sm" onClick={() => useAppStore.getState().setView('gallery')}>
          Browse examples
        </button>
      </div>
    </div>
  )
}
