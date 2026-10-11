import type { AdapterKind, LlmProvider } from '../ai/types'

/** A keeps the model's default; B and C sample hotter for more different shapes. */
export const VARIANT_TEMPERATURES = [undefined, 0.7, 1.0] as const

/** The Anthropic adapter drops temperature, so its variants differ by sampling alone. */
export function variantTemperatures(adapter: AdapterKind, count: number): Array<number | undefined> {
  return VARIANT_TEMPERATURES.slice(0, count).map((t) => (adapter === 'anthropic' ? undefined : t))
}

/** runTurn has no temperature option; this sets ChatRequest.temperature on the way to the provider. */
export function withTemperature(provider: LlmProvider, temperature: number | undefined): LlmProvider {
  if (temperature === undefined) return provider
  return {
    listModels: (signal) => provider.listModels(signal),
    streamChat: (req, signal) => provider.streamChat({ ...req, temperature: req.temperature ?? temperature }, signal),
  }
}
