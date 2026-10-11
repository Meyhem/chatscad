import { act, renderHook } from '@testing-library/react'
import { ProviderError, type LlmProvider, type ModelInfo } from '../ai/types'
import { newProfile } from '../db/profiles'
import type { ProviderProfile } from '../db/db'
import { useProvidersStore } from './providersStore'
import { listsWithoutKey, useModelList } from './useModelList'

const MODELS: ModelInfo[] = [{ id: 'm1' }, { id: 'm2' }]
let updateProfile: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  updateProfile = vi.fn(async () => {})
  useProvidersStore.setState({ updateProfile } as never)
})
afterEach(() => {
  vi.useRealTimers()
  useProvidersStore.setState(useProvidersStore.getInitialState(), true)
})

function providerWith(listModels: LlmProvider['listModels']) {
  const provider = { listModels: vi.fn(listModels), streamChat: vi.fn() } as unknown as LlmProvider & { listModels: ReturnType<typeof vi.fn> }
  return { provider, create: () => provider }
}

const profile = (over: Partial<ProviderProfile>) => newProfile({ name: 'P', adapter: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', ...over })

it('lists models without a key for OpenRouter and servers on this computer, but not for others', () => {
  expect(listsWithoutKey('https://openrouter.ai/api/v1')).toBe(true)
  expect(listsWithoutKey('http://localhost:11434/v1')).toBe(true)
  expect(listsWithoutKey('https://api.openai.com/v1')).toBe(false)
  expect(listsWithoutKey('not a url')).toBe(false)
})

it('loads on its own for a server that needs no key, and saves the list on the profile', async () => {
  const { provider, create } = providerWith(async () => MODELS)
  const p = profile({ baseUrl: 'http://localhost:11434/v1' })
  const { result } = renderHook(() => useModelList(p, { create }))
  expect(result.current).toEqual({ phase: 'loading' })
  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(provider.listModels).toHaveBeenCalledOnce()
  expect(result.current).toEqual({ phase: 'loaded', count: 2 })
  expect(updateProfile).toHaveBeenCalledWith(p.id, { cachedModels: MODELS })
})

it('waits for a key otherwise, and restarts the wait while the key is typed', async () => {
  const { provider, create } = providerWith(async () => MODELS)
  const { result, rerender } = renderHook(({ p }) => useModelList(p, { create }), { initialProps: { p: profile({ apiKey: '' }) } })
  await act(() => vi.advanceTimersByTimeAsync(2_000))
  expect(provider.listModels).not.toHaveBeenCalled()
  expect(result.current).toEqual({ phase: 'idle' })

  rerender({ p: profile({ apiKey: 'sk-1' }) })
  await act(() => vi.advanceTimersByTimeAsync(300))
  rerender({ p: profile({ apiKey: 'sk-12' }) })
  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(provider.listModels).toHaveBeenCalledOnce()
})

it('says what failed', async () => {
  const { create } = providerWith(async () => {
    throw new ProviderError('auth', 'Invalid key', 401)
  })
  const { result } = renderHook(() => useModelList(profile({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'bad' }), { create }))
  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(result.current).toEqual({ phase: 'error', reason: 'openrouter.ai rejected the API key' })
})

it('ignores an answer that arrives after a newer request started', async () => {
  let resolveFirst: (m: ModelInfo[]) => void = () => {}
  const calls: number[] = []
  const { create } = providerWith(() => {
    calls.push(calls.length)
    return calls.length === 1 ? new Promise((r) => (resolveFirst = r)) : Promise.resolve([{ id: 'new' }])
  })
  const { result, rerender } = renderHook(({ p }) => useModelList(p, { create }), { initialProps: { p: profile({ apiKey: 'sk-1' }) } })
  await act(() => vi.advanceTimersByTimeAsync(600))
  rerender({ p: profile({ apiKey: 'sk-2' }) })
  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(result.current).toEqual({ phase: 'loaded', count: 1 })
  await act(async () => resolveFirst([{ id: 'old' }, { id: 'older' }]))
  expect(result.current).toEqual({ phase: 'loaded', count: 1 })
  expect(updateProfile).toHaveBeenCalledTimes(1)
  expect(updateProfile).toHaveBeenLastCalledWith(expect.any(String), { cachedModels: [{ id: 'new' }] })
})


it('keeps the list it already has when the form opens, and loads again once the key changes', async () => {
  const { provider, create } = providerWith(async () => MODELS)
  const cached = profile({ apiKey: 'sk-1', cachedModels: [{ id: 'old' }] })
  const { result, rerender } = renderHook(({ p }) => useModelList(p, { create }), { initialProps: { p: cached } })
  await act(() => vi.advanceTimersByTimeAsync(1_000))
  expect(provider.listModels).not.toHaveBeenCalled()
  expect(result.current).toEqual({ phase: 'idle' })
  rerender({ p: { ...cached, apiKey: 'sk-2' } })
  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(provider.listModels).toHaveBeenCalledOnce()
})
