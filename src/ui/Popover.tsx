import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

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
