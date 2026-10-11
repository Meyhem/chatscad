import { describeProviderError } from '../ai/errors'
import { ProviderError, type LlmProvider, type ModelInfo, type ProviderErrorKind } from '../ai/types'
import { hostOf } from '../ai/url'

export type ConnectionResult =
  | { ok: true; models: ModelInfo[] | null; title: string; body: string }
  | { ok: false; models: ModelInfo[] | null; kind: ProviderErrorKind | null; title: string; body: string }

/** Lists models (optional on some servers), then sends a tiny request to the default model. */
export async function testConnection(provider: LlmProvider, model: string, baseUrl: string, signal?: AbortSignal): Promise<ConnectionResult> {
  const fail = (err: unknown, models: ModelInfo[] | null): ConnectionResult => ({
    ok: false,
    models,
    kind: err instanceof ProviderError ? err.kind : null,
    ...describeProviderError(err, baseUrl),
  })

  let models: ModelInfo[] | null = null
  try {
    models = await provider.listModels(signal)
  } catch (err) {
    const noList = err instanceof ProviderError && (err.kind === 'not-found' || err.kind === 'bad-request')
    if (!noList) return fail(err, null)
  }

  const host = hostOf(baseUrl)
  const listed = models ? ` · ${models.length} ${models.length === 1 ? 'model' : 'models'} listed` : ''
  const name = model.trim()
  if (name === '') {
    if (models) return { ok: true, models, title: 'Connection works', body: `${host} answered${listed}. Pick a default model to finish.` }
    return {
      ok: false,
      models,
      kind: null,
      title: 'Set a default model',
      body: `${host} doesn't list its models. Type the model name in Default model, then test again.`,
    }
  }

  try {
    const stream = provider
      .streamChat({ model: name, system: 'Reply with the word OK.', messages: [{ role: 'user', content: 'Say OK.' }], maxTokens: 16 }, signal)
      [Symbol.asyncIterator]()
    while (!(await stream.next()).done) {
      // drain the reply; only errors matter here
    }
  } catch (err) {
    return fail(err, models)
  }
  return { ok: true, models, title: 'Connection works', body: `${name} on ${host} replied${listed}.` }
}
