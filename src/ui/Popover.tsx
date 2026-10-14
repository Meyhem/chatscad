import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Space kept between the popover and the window edge. */
const GUTTER = 12

export interface PopoverTriggerProps {
  'aria-expanded': boolean
  'aria-haspopup': 'dialog'
  'aria-controls': string
  onClick(): void
}

/** A small non-modal dialog anchored to its button: Escape and clicks outside close it. */
export function Popover({
  label,
  trigger,
  className = '',
  children,
}: {
  label: string
  trigger(props: PopoverTriggerProps): ReactNode
  className?: string
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // Anchored to its button, a wide popover in a narrow column can run past the window edge: slide it back inside.
  useLayoutEffect(() => {
    const el = panel.current
    if (!open || !el) return
    const fit = () => {
      el.style.transform = ''
      const { left, right } = el.getBoundingClientRect()
      const shift = left < GUTTER ? GUTTER - left : right > window.innerWidth - GUTTER ? window.innerWidth - GUTTER - right : 0
      if (shift) el.style.transform = `translateX(${shift}px)`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    root.current?.querySelector<HTMLElement>('[aria-haspopup="dialog"]')?.focus()
  }

  return (
    <div ref={root} className="relative">
      {trigger({ 'aria-expanded': open, 'aria-haspopup': 'dialog', 'aria-controls': id, onClick: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          className={`pc-popover ${className}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}
