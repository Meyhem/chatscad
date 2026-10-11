import type { MouseEvent, PointerEvent } from 'react'

export const SYMBOL_KEYS = [';', '{', '}', '(', ')', '[', ']'] as const
export const INDENT = '  '

const KEY = 'h-10 min-w-0 flex-1 rounded-sm border border-line bg-panel font-mono text-[15px] font-medium text-ink'

/** Cancelling the press keeps focus (and the phone keyboard) in the editor. */
const keepFocus = (e: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) => e.preventDefault()

export function KeyRow({ onInsert }: { onInsert(text: string): void }) {
  return (
    <div role="toolbar" aria-label="Code symbols" className="flex shrink-0 gap-1 border-t border-line bg-panel-raised px-2 py-1">
      {SYMBOL_KEYS.map((key) => (
        <button key={key} type="button" className={KEY} onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onInsert(key)}>
          {key}
        </button>
      ))}
      <button type="button" aria-label="Indent" className={KEY} onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onInsert(INDENT)}>
        ⇥
      </button>
    </div>
  )
}
