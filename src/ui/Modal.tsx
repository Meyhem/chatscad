import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Props {
  labelledBy: string
  onClose(): void
  /** false for dialogs whose content would be lost by a stray click (the variant picker). */
  closeOnScrim?: boolean
  className?: string
  children: ReactNode
}

export function Modal({ labelledBy, onClose, closeOnScrim = true, className = '', children }: Props) {
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => previous?.focus()
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !dialog.current) return
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="pc-scrim fixed inset-0 z-50 grid place-items-center overflow-y-auto p-3 md:p-6"
      onMouseDown={(e) => {
        if (closeOnScrim && e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={className} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
