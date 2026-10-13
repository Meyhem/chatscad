import { useEffect, useRef, useState } from 'react'
import { effortFor, reasoningSupport } from '../ai/effort'
import type { ReasoningEffort } from '../ai/types'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { IconCheck, IconChevron } from '../ui/icons'

type Choice = ReasoningEffort | null

const OPTIONS: Array<{ value: Choice; label: string; caption?: string }> = [
  { value: null, label: 'Default', caption: 'The model decides' },
  { value: 'off', label: 'Off', caption: 'No reasoning, fastest' },
  { value: 'low', label: 'Low', caption: 'Faster, cheaper' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High', caption: 'Slower, more tokens' },
]

/** Reasoning effort for the active model; only for models that report support. */
export function EffortPicker() {
  const profile = useProvidersStore(selectActiveProfile)
  const model = useProvidersStore(selectActiveModel)
  const setReasoningEffort = useProvidersStore((s) => s.setReasoningEffort)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!profile || !model) return null
  const support = reasoningSupport(profile, model)
  if (!support.efforts) return null
  const current: Choice = effortFor(profile, model) ?? null
  const options = OPTIONS.filter((o) => o.value !== 'off' || support.canDisable)
  const label = OPTIONS.find((o) => o.value === current)?.label ?? 'Default'

  const move = (step: number) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + step + items.length) % items.length]?.focus()
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className="pc-model whitespace-nowrap"
        aria-label={`Reasoning effort: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="pc-opt-k">Effort</span>
        {label}
        <IconChevron className="pc-i" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Reasoning effort"
          className="absolute bottom-full left-0 z-10 mb-2 flex w-56 flex-col gap-0.5 rounded-lg border border-line bg-panel-raised p-1 shadow-pop"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              move(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              move(-1)
            }
          }}
        >
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === current}
              className="grid grid-cols-[16px_1fr] gap-x-1.5 rounded-sm px-2 py-1.5 text-left text-[13px] text-ink hover:bg-panel aria-checked:bg-accent-soft"
              onClick={() => {
                void setReasoningEffort(profile.id, model, o.value)
                setOpen(false)
              }}
            >
              <span>{o.value === current && <IconCheck className="pc-i" aria-hidden="true" />}</span>
              <span>
                {o.label}
                {o.caption && <span className="pc-caption block">{o.caption}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
