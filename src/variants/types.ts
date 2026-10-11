import type { PromptContext } from '../ai/prompt'
import type { LlmMessage, LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import type { RenderResult } from '../render/types'

export const VARIANT_LETTERS = ['A', 'B', 'C'] as const
export type VariantLetter = (typeof VARIANT_LETTERS)[number]

export interface VariantRequest {
  provider: LlmProvider
  profile: ProviderProfile
  model: string
  history: LlmMessage[]
  userText: string
  ctx: PromptContext
  maxFixAttempts: number
  projectId: string | null
  /** The head when the prompt was sent; variants of a follow-up edit branch from it. */
  parentId: string | null
}

export type SlotStatus = 'generating' | 'queued' | 'fixing' | 'ok' | 'error' | 'no-code' | 'failed-request' | 'cancelled'

export interface SlotUsage {
  inputTokens: number
  outputTokens: number
  cost: number | null
}

export interface VariantSlot {
  letter: VariantLetter
  model: string
  temperature: number | undefined
  status: SlotStatus
  /** Latest code from the model (or its auto-fix). */
  code: string | null
  /** Latest finished render, and the code it belongs to (may lag `code` while a fix renders). */
  result: RenderResult | null
  resultCode: string | null
  prose: string
  usage: SlotUsage
  fixAttempt: number
  /** Order in which this slot's pending render entered the queue; null when none is pending. */
  renderSeq: number | null
  error: { title: string; body: string } | null
}

export function initialSlots(model: string, temperatures: Array<number | undefined>): VariantSlot[] {
  return temperatures.map((temperature, i) => ({
    letter: VARIANT_LETTERS[i],
    model,
    temperature,
    status: 'generating',
    code: null,
    result: null,
    resultCode: null,
    prose: '',
    usage: { inputTokens: 0, outputTokens: 0, cost: null },
    fixAttempt: 0,
    renderSeq: null,
    error: null,
  }))
}
