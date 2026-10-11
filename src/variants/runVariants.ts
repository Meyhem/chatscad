import { computeCost } from '../ai/cost'
import { describeProviderError } from '../ai/errors'
import type { runTurn } from '../ai/runTurn'
import type { UsageRecord } from '../db/db'
import type { RenderQueue } from '../render/queue'
import { variantPrompt, withTemperature } from './temperatures'
import type { SlotStatus, SlotUsage, VariantRequest, VariantSlot } from './types'

export interface RunVariantsDeps {
  queue: Pick<RenderQueue, 'render'>
  runTurn: typeof runTurn
  recordUsage(record: Omit<UsageRecord, 'id' | 'createdAt'>): Promise<void>
}

/** One runTurn per slot, in parallel; renders go through the background queue and never touch the editor. */
export async function runVariants(
  req: VariantRequest,
  slots: VariantSlot[],
  opts: { signal: AbortSignal; onSlot(index: number, patch: Partial<VariantSlot>): void },
  deps: RunVariantsDeps,
): Promise<void> {
  let renderSeq = 0
  const priceOf = (model: string) => req.profile.priceTable[model] ?? req.profile.cachedModels.find((m) => m.id === model)?.price

  await Promise.all(
    slots.map(async (slot, i) => {
      const usage: SlotUsage = { inputTokens: 0, outputTokens: 0, cost: null }
      let status: SlotStatus = slot.status
      const update = (patch: Partial<VariantSlot>) => {
        if (patch.status) status = patch.status
        opts.onSlot(i, patch)
      }

      try {
        await deps.runTurn({
          provider: withTemperature(req.provider, slot.temperature),
          model: slot.model,
          history: req.history,
          userText: variantPrompt(req.userText, i),
          ctx: req.ctx,
          maxFixAttempts: req.maxFixAttempts,
          signal: opts.signal,
          render: async (code, signal) => {
            update({ status: 'queued', renderSeq: ++renderSeq })
            const result = await deps.queue.render({ code }, signal)
            update({ status: result.ok ? 'ok' : 'error', result, resultCode: code, renderSeq: null })
            return result
          },
          apply: (code) => update({ code }),
          onEvent: (e) => {
            if (e.type === 'reply') {
              const { cost, costSource } = computeCost(e.result.usage, priceOf(e.result.model))
              usage.inputTokens += e.result.usage.inputTokens
              usage.outputTokens += e.result.usage.outputTokens
              if (cost !== null) usage.cost = (usage.cost ?? 0) + cost
              update({
                usage: { ...usage },
                prose: e.result.prose,
                model: e.result.model,
                ...(e.result.code === null && e.attempt === 0 ? { status: 'no-code' as const } : {}),
              })
              void deps
                .recordUsage({
                  profileId: req.profile.id,
                  model: e.result.model,
                  inputTokens: e.result.usage.inputTokens,
                  outputTokens: e.result.usage.outputTokens,
                  cost,
                  costSource,
                  projectId: req.projectId,
                  versionId: null,
                })
                .catch((err: unknown) => console.warn('Could not record token usage', err))
            } else if (e.type === 'fixing') {
              update({ status: 'fixing', fixAttempt: e.attempt })
            } else if (e.type === 'gave-up' && status !== 'error') {
              update({ status: 'error' })
            }
          },
        })
        if (status === 'generating') update({ status: 'no-code' })
      } catch (e) {
        if (opts.signal.aborted) update({ status: 'cancelled', renderSeq: null })
        else update({ status: 'failed-request', error: describeProviderError(e, req.profile.baseUrl), renderSeq: null })
      }
    }),
  )
}
