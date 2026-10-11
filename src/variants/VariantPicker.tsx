import { formatCost } from '../ui/format'
import { IconCheck, IconClock, IconRefresh, IconSpinner, IconWarning, IconX } from '../ui/icons'
import { Modal } from '../ui/Modal'
import { describeSlot, type SlotTone, type SlotView } from './describeSlot'
import type { VariantSlot } from './types'
import { VariantPreview } from './VariantPreview'
import { useVariantStore } from './variantStore'

const ICONS = { busy: IconSpinner, ok: IconCheck, warn: IconWarning, error: IconX, neutral: IconClock } as const

function SlotPill({ tone, label }: { tone: SlotTone; label: string }) {
  const Icon = ICONS[tone]
  return (
    <span className={`pc-status ${tone === 'neutral' ? '' : `is-${tone}`}`.trim()}>
      <Icon className="pc-i" aria-hidden="true" />
      {label}
    </span>
  )
}

function VariantCard({ slot, view, selected, onSelect }: { slot: VariantSlot; view: SlotView; selected: boolean; onSelect(): void }) {
  const mesh = slot.status === 'ok' && slot.result?.ok ? slot.result.mesh : null
  const failed = slot.status === 'error' || slot.status === 'failed-request'
  const spent = slot.usage.inputTokens + slot.usage.outputTokens === 0 ? formatCost(0) : formatCost(slot.usage.cost)
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`pc-variant cursor-pointer ${failed ? 'is-failed' : ''}`.trim()}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <span className="pc-variant-view w-full">
        {mesh ? <VariantPreview key={slot.resultCode ?? ''} mesh={mesh} label={`Variant ${slot.letter}`} /> : <SlotPill tone={view.tone} label={view.label} />}
      </span>
      <span className="pc-variant-meta">
        <span className="min-w-0 truncate font-semibold">
          {slot.letter} · {slot.model}
        </span>
        <SlotPill tone={view.tone} label={view.label} />
      </span>
      <span className="pc-variant-meta pc-caption">
        <span className="pc-mono min-w-0 truncate">{view.detail}</span>
        <span className="pc-mono">{spent}</span>
      </span>
    </div>
  )
}

export function VariantPicker() {
  const open = useVariantStore((s) => s.open)
  const request = useVariantStore((s) => s.request)
  const slots = useVariantStore((s) => s.slots)
  const selected = useVariantStore((s) => s.selected)
  const picking = useVariantStore((s) => s.picking)
  const error = useVariantStore((s) => s.error)
  const select = useVariantStore((s) => s.select)
  const pick = useVariantStore((s) => s.pick)
  const discard = useVariantStore((s) => s.discard)
  const regenerate = useVariantStore((s) => s.regenerate)
  if (!open || !request) return null

  const chosen = selected !== null ? slots[selected] : null
  const canUse = chosen?.status === 'ok' && !picking

  return (
    <Modal
      labelledBy="variants-title"
      // Once a reply has code, only Discard all or Close throws the variants away; Esc is too easy to hit.
      onClose={() => {
        if (!slots.some((s) => s.code !== null)) discard()
      }}
      closeOnScrim={false}
      className="flex w-full max-w-[1180px] flex-col gap-5 rounded-lg border border-line bg-panel p-6 shadow-pop"
    >
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="variants-title" className="text-[20px] leading-[26px] font-semibold tracking-[-0.01em]">
            Pick a variant
          </h2>
          <p className="pc-muted">
            “{request.userText}” Sent {slots.length} times at once to {request.model}.
          </p>
        </div>
        <button type="button" className="pc-btn is-icon is-ghost" aria-label="Close" onClick={discard}>
          <IconX className="pc-i" aria-hidden="true" />
        </button>
      </div>

      <div role="listbox" aria-label="Variants" className="grid gap-4 md:grid-cols-3">
        {slots.map((slot, i) => (
          <VariantCard
            key={slot.letter}
            slot={slot}
            view={describeSlot(slot, slots, request.maxFixAttempts)}
            selected={selected === i}
            onSelect={() => select(i)}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="pc-caption text-error">
          {error}
        </p>
      )}

      <div className="pc-row justify-between">
        <span className="pc-caption">Drag to orbit any preview. The ones you don't pick stay in history as variants.</span>
        <div className="pc-row">
          <button type="button" className="pc-btn is-ghost" onClick={discard}>
            Discard all
          </button>
          <button type="button" className="pc-btn" onClick={regenerate}>
            <IconRefresh className="pc-i" aria-hidden="true" />
            Regenerate
          </button>
          <button type="button" className="pc-btn is-primary" disabled={!canUse} onClick={() => void pick()}>
            {chosen ? `Use variant ${chosen.letter}` : 'Use variant'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
