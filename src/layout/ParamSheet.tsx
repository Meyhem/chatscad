import { useState, type ReactNode } from 'react'

/** Bottom sheet over the 3D tab; the grabber row toggles it. */
export function ParamSheet({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative -mt-3 flex max-h-[60%] shrink-0 flex-col rounded-t-lg border-t border-line bg-panel-raised px-4 pb-4 shadow-pop">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="param-sheet-body"
        className="flex min-h-(--touch-target) flex-col items-center justify-center gap-1 pt-2 font-semibold text-ink"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="h-1 w-9 rounded-pill bg-line-strong" />
        Parameters
      </button>
      <div id="param-sheet-body" hidden={!open} className="min-h-0 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
