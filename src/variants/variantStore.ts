import { create } from 'zustand'
import { runTurn } from '../ai/runTurn'
import { errorMessage } from '../render/result'
import { getRenderQueue } from '../render/sharedQueue'
import { commitPick } from './commitPick'
import { recordUsage } from './recordUsage'
import { runVariants } from './runVariants'
import { variantTemperatures } from './temperatures'
import { initialSlots, type VariantRequest, type VariantSlot } from './types'

export const VARIANT_COUNT = 3

interface VariantData {
  open: boolean
  groupId: string | null
  request: VariantRequest | null
  slots: VariantSlot[]
  selected: number | null
  picking: boolean
  error: string | null
}

interface VariantState extends VariantData {
  start(req: VariantRequest): void
  regenerate(): void
  discard(): void
  select(index: number): void
  pick(): Promise<void>
}

const CLOSED: VariantData = { open: false, groupId: null, request: null, slots: [], selected: null, picking: false, error: null }

let controller: AbortController | null = null

export const useVariantStore = create<VariantState>()((set, get) => ({
  ...CLOSED,

  start: (req) => {
    controller?.abort()
    const run = new AbortController()
    controller = run
    const slots = initialSlots(req.model, variantTemperatures(req.profile.adapter, VARIANT_COUNT))
    set({ open: true, groupId: crypto.randomUUID(), request: req, slots, selected: null, picking: false, error: null })
    void runVariants(
      req,
      slots,
      {
        signal: run.signal,
        onSlot: (i, patch) => {
          if (controller !== run) return
          set((s) => {
            const next = s.slots.slice()
            next[i] = { ...next[i], ...patch }
            return { slots: next, selected: s.selected ?? (patch.status === 'ok' ? i : null) }
          })
        },
      },
      { queue: getRenderQueue(), runTurn, recordUsage },
    )
  },

  regenerate: () => {
    const { request } = get()
    if (request) get().start(request)
  },

  discard: () => {
    controller?.abort()
    controller = null
    set(CLOSED)
  },

  select: (index) => set({ selected: index }),

  pick: async () => {
    const { request, slots, selected, groupId } = get()
    if (!request || !groupId || selected === null || slots[selected]?.status !== 'ok') return
    set({ picking: true, error: null })
    // Stop the others; whatever code they have is still stored as a variant.
    controller?.abort()
    controller = null
    try {
      await commitPick({ projectId: request.projectId, parentId: request.parentId, groupId, prompt: request.userText, slots, picked: selected })
      set(CLOSED)
    } catch (e) {
      set({ picking: false, error: `Could not save the variants: ${errorMessage(e)}` })
    }
  },
}))
