import { useEffect, useRef, useState } from 'react'
import { createProvider } from '../ai/createProvider'
import { describeProviderError } from '../ai/errors'
import { isLocalBaseUrl } from '../ai/url'
import type { ProviderProfile } from '../db/db'
import { useProvidersStore } from './providersStore'

export type ModelListState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'loaded'; count: number }
  | { phase: 'error'; reason: string }

/** OpenRouter and servers on this computer list their models without an API key. */
export function listsWithoutKey(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai' || isLocalBaseUrl(baseUrl)
  } catch {
    return false
  }
}

const canList = (p: ProviderProfile) => p.baseUrl.trim() !== '' && (p.apiKey.trim() !== '' || listsWithoutKey(p.baseUrl))

/**
 * Loads the provider's model list into `cachedModels` shortly after the address or key changes,
 * so the Default model field can offer it without a connection test. Only the latest request counts.
 * A profile that already has a list keeps it when the form opens: saving a new list would clear its status.
 */
export function useModelList(
  profile: ProviderProfile,
  { delayMs = 600, create = createProvider }: { delayMs?: number; create?: typeof createProvider } = {},
): ModelListState {
  const cachedOnOpen = profile.cachedModels.length > 0
  const target = `${profile.adapter} ${profile.baseUrl} ${profile.apiKey}`
  /** The address and key the cached list came with; unchanged, there is nothing new to load. */
  const cachedFor = useRef(cachedOnOpen ? target : null)
  const [state, setState] = useState<ModelListState>(() => (canList(profile) && !cachedOnOpen ? { phase: 'loading' } : { phase: 'idle' }))
  const latest = useRef(profile)
  latest.current = profile
  const { baseUrl, apiKey, adapter } = profile

  useEffect(() => {
    const p = latest.current
    if (cachedFor.current === `${adapter} ${baseUrl} ${apiKey}` || !canList(p)) {
      setState({ phase: 'idle' })
      return
    }
    setState({ phase: 'loading' })
    const controller = new AbortController()
    const timer = setTimeout(() => {
      create(p)
        .listModels(controller.signal)
        .then(
          (models) => {
            if (controller.signal.aborted) return
            cachedFor.current = `${adapter} ${baseUrl} ${apiKey}`
            // Saving clears the profile's connection status, so only save a list that changed.
            const stored = useProvidersStore.getState().profiles.find((x) => x.id === p.id)?.cachedModels ?? latest.current.cachedModels
            if (JSON.stringify(stored) !== JSON.stringify(models)) void useProvidersStore.getState().updateProfile(p.id, { cachedModels: models })
            setState({ phase: 'loaded', count: models.length })
          },
          (err: unknown) => {
            if (!controller.signal.aborted) setState({ phase: 'error', reason: describeProviderError(err, p.baseUrl).title })
          },
        )
    }, delayMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [baseUrl, apiKey, adapter, delayMs, create])

  return state
}
