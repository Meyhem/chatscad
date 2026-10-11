import { formatDims } from '../render/dims'
import { parseCustomizer } from '../scad/customizer'
import { describeStatus } from '../ui/StatusPill'
import type { VariantSlot } from './types'

export type SlotTone = 'busy' | 'ok' | 'warn' | 'error' | 'neutral'

export interface SlotView {
  tone: SlotTone
  label: string
  detail: string
}

function paramsLabel(code: string | null): string {
  const n = code ? parseCustomizer(code).length : 0
  return `${n} param${n === 1 ? '' : 's'}`
}

/** The queue is FIFO, so the queued slot that entered first is the one compiling now. */
export function isRenderingNow(slot: VariantSlot, all: VariantSlot[]): boolean {
  if (slot.status !== 'queued' || slot.renderSeq === null) return false
  const pending = all.flatMap((s) => (s.status === 'queued' && s.renderSeq !== null ? [s.renderSeq] : []))
  return slot.renderSeq === Math.min(...pending)
}

export function describeSlot(slot: VariantSlot, all: VariantSlot[], maxFixAttempts: number): SlotView {
  switch (slot.status) {
    case 'generating':
      return { tone: 'busy', label: 'Generating…', detail: 'waiting for the model' }
    case 'queued':
      return isRenderingNow(slot, all)
        ? { tone: 'busy', label: 'Rendering…', detail: 'compiling in the background' }
        : { tone: 'neutral', label: 'Queued', detail: 'waiting for the renderer' }
    case 'fixing':
      return { tone: 'busy', label: `Auto-fix ${slot.fixAttempt} of ${maxFixAttempts}`, detail: 'sending the errors back' }
    case 'ok': {
      const r = slot.result
      const warnings = r?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0
      const dims = r?.ok ? formatDims(r.mesh.bounds) : 'size unknown'
      return {
        tone: warnings > 0 ? 'warn' : 'ok',
        label: warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : 'Rendered',
        detail: `${dims} · ${paramsLabel(slot.code)}`,
      }
    }
    case 'error': {
      const r = slot.result
      const label = r && !r.ok ? describeStatus('error', r.renderMs, r.error, r.diagnostics).label : 'Failed'
      return { tone: 'error', label, detail: 'did not compile' }
    }
    case 'no-code':
      return { tone: 'warn', label: 'No code', detail: 'the reply had no OpenSCAD code' }
    case 'failed-request':
      return { tone: 'error', label: 'Request failed', detail: slot.error?.title ?? 'the provider returned an error' }
    case 'cancelled':
      return { tone: 'neutral', label: 'Stopped', detail: 'cancelled' }
  }
}

/** Header pill text while the picker works; null once every slot has settled. */
export function variantProgressLabel(slots: VariantSlot[]): string | null {
  const total = slots.length
  if (slots.some((s) => s.status === 'generating')) return `Generating ${total} variants`
  const pending = slots.filter((s) => s.status === 'queued' || s.status === 'fixing').length
  return pending === 0 ? null : `Rendering ${total - pending + 1} of ${total}`
}
