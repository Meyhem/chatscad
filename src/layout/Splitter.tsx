import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

const STEP = 16

interface Props {
  orientation: 'vertical' | 'horizontal'
  label: string
  /** Size in px of the pane this divider resizes. */
  value: number
  min: number
  max: number
  defaultValue: number
  /** The pane sits right of or below the divider, so it grows as the divider moves left or up. */
  invert?: boolean
  /** Live size while dragging. */
  onChange(value: number): void
  /** Final size: on release, on a key press, or the default on double-click. */
  onCommit(value: number): void
  /** Double-click handler for panes whose default is not a fixed size; replaces committing `defaultValue`. */
  onReset?(): void
}

/** A draggable, keyboard-operable divider between two panels. */
export function Splitter({ orientation, label, value, min, max, defaultValue, invert = false, onChange, onCommit, onReset }: Props) {
  const start = useRef<{ pos: number; value: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const vertical = orientation === 'vertical'
  const sign = invert ? -1 : 1
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)))
  const pos = (e: PointerEvent) => (vertical ? e.clientX : e.clientY)
  const sized = (e: PointerEvent) => clamp(start.current!.value + (pos(e) - start.current!.pos) * sign)

  const keys: Record<string, (v: number) => number> = {
    [vertical ? 'ArrowLeft' : 'ArrowUp']: (v) => v - STEP * sign,
    [vertical ? 'ArrowRight' : 'ArrowDown']: (v) => v + STEP * sign,
    Home: () => min,
    End: () => max,
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Drag to resize. Double-click to reset."
      data-dragging={dragging || undefined}
      className={`relative z-10 shrink-0 touch-none bg-line outline-none select-none after:absolute after:content-[''] hover:bg-line-strong focus-visible:bg-accent data-dragging:bg-accent ${
        vertical ? 'w-px cursor-col-resize after:inset-y-0 after:-inset-x-1' : 'h-px cursor-row-resize after:inset-x-0 after:-inset-y-1'
      }`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { pos: pos(e), value }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(sized(e))
      }}
      onPointerUp={(e) => {
        if (!start.current) return
        const v = sized(e)
        start.current = null
        setDragging(false)
        onCommit(v)
      }}
      onPointerCancel={() => {
        start.current = null
        setDragging(false)
      }}
      onDoubleClick={() => (onReset ? onReset() : onCommit(defaultValue))}
      onKeyDown={(e: KeyboardEvent) => {
        const next = keys[e.key]
        if (!next) return
        e.preventDefault()
        const v = clamp(next(value))
        onChange(v)
        onCommit(v)
      }}
    />
  )
}
