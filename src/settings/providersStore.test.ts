import { DEFAULT_SETTINGS, type ProviderProfile } from '../db/db'
import { getProfile, newProfile, saveProfile } from '../db/profiles'
import { getSettings, updateSettings } from '../db/settings'
import { resetDb } from '../test/db'
import { PROVIDER_PRESETS } from './presets'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from './providersStore'

beforeEach(async () => {
  await resetDb()
  useProvidersStore.setState(useProvidersStore.getInitialState(), true)
})

const preset = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id)!

it('ships the seven presets from the design doc', () => {
  expect(PROVIDER_PRESETS.map((p) => [p.label, p.adapter, p.baseUrl])).toEqual([
    ['OpenAI', 'openai-compatible', 'https://api.openai.com/v1'],
    ['OpenRouter', 'openai-compatible', 'https://openrouter.ai/api/v1'],
    ['DeepInfra', 'openai-compatible', 'https://api.deepinfra.com/v1/openai'],
    ['Ollama', 'openai-compatible', 'http://localhost:11434/v1'],
    ['LM Studio', 'openai-compatible', 'http://localhost:1234/v1'],
    ['Anthropic', 'anthropic', 'https://api.anthropic.com'],
    ['Custom', 'openai-compatible', ''],
  ])
})

it('loads profiles and settings from the database', async () => {
  const p = await saveProfile(newProfile({ name: 'A', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com' }))
  await updateSettings({ activeProfileId: p.id, activeModel: 'claude-x' })
  await useProvidersStore.getState().load()
  const s = useProvidersStore.getState()
  expect(s.loaded).toBe(true)
  expect(s.profiles).toEqual([p])
  expect(s.settings).toMatchObject({ activeProfileId: p.id, activeModel: 'claude-x' })
})

it('adds a profile from a preset, saves it, and makes the first one active', async () => {
  const p = await useProvidersStore.getState().addProfile(preset('ollama'))
  expect(p).toMatchObject({ name: 'Ollama on this computer', adapter: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' })
  expect(await getProfile(p.id)).toEqual(p)
  expect(useProvidersStore.getState().settings.activeProfileId).toBe(p.id)
  const second = await useProvidersStore.getState().addProfile(preset('openai'))
  expect(useProvidersStore.getState().settings.activeProfileId).toBe(p.id)
  expect(useProvidersStore.getState().profiles.map((x) => x.id)).toEqual([p.id, second.id])
})

it('updates state at once, persists the change, and clears the stale connection status', async () => {
  const p = await useProvidersStore.getState().addProfile(preset('custom'))
  useProvidersStore.getState().setStatus(p.id, 'ok')
  const saving = useProvidersStore.getState().updateProfile(p.id, { baseUrl: 'https://llm.test/v1' })
  expect(useProvidersStore.getState().profiles[0].baseUrl).toBe('https://llm.test/v1')
  expect(useProvidersStore.getState().status[p.id]).toBeUndefined()
  await saving
  expect((await getProfile(p.id))?.baseUrl).toBe('https://llm.test/v1')
})

it('removes a profile and forgets it as the active one', async () => {
  const p = await useProvidersStore.getState().addProfile(preset('anthropic'))
  await useProvidersStore.getState().removeProfile(p.id)
  expect(useProvidersStore.getState().profiles).toEqual([])
  expect(useProvidersStore.getState().settings.activeProfileId).toBeNull()
  expect(await getProfile(p.id)).toBeUndefined()
})

it('remembers the model chosen in the composer', async () => {
  const p = await useProvidersStore.getState().addProfile(preset('openrouter'))
  await useProvidersStore.getState().chooseModel(p.id, 'qwen/qwen3-coder')
  expect(selectActiveModel(useProvidersStore.getState())).toBe('qwen/qwen3-coder')
  expect(await getSettings()).toMatchObject({ activeProfileId: p.id, activeModel: 'qwen/qwen3-coder' })
})

describe('active profile and model', () => {
  const a = newProfile({ name: 'A', adapter: 'openai-compatible', baseUrl: 'https://a.test/v1', defaultModel: 'a-default' })
  const b = newProfile({ name: 'B', adapter: 'openai-compatible', baseUrl: 'https://b.test/v1', defaultModel: '' })
  const state = (settings: Partial<typeof DEFAULT_SETTINGS>) => ({
    ...useProvidersStore.getInitialState(),
    profiles: [a, b],
    settings: { ...DEFAULT_SETTINGS, ...settings },
  })

  it('falls back to the first profile and its default model', () => {
    expect(selectActiveProfile(state({}))).toBe(a)
    expect(selectActiveModel(state({}))).toBe('a-default')
  })

  it('uses the chosen model only for the profile it was chosen with', () => {
    expect(selectActiveModel(state({ activeProfileId: a.id, activeModel: 'a-other' }))).toBe('a-other')
    expect(selectActiveModel(state({ activeProfileId: b.id, activeModel: null }))).toBeNull()
  })

  it('is empty without profiles', () => {
    expect(selectActiveProfile(useProvidersStore.getInitialState())).toBeNull()
    expect(selectActiveModel(useProvidersStore.getInitialState())).toBeNull()
  })
})

describe('passphrase lock in the open tab', () => {
  it('"Lock now" locks the profiles this tab already holds, so a provider call fails before any request', async () => {
    const { enableLock, lock } = await import('../security/lock')
    const { createProvider } = await import('../ai/createProvider')
    await saveProfile(newProfile({ name: 'P', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', apiKey: 'sk-plain', defaultModel: 'm' }))
    await useProvidersStore.getState().load()
    await enableLock('correct horse battery')
    lock()
    await vi.waitFor(() => expect(selectActiveProfile(useProvidersStore.getState())?.keyEncrypted).toBe(true))
    const provider = createProvider(selectActiveProfile(useProvidersStore.getState())!)
    await expect(provider.listModels()).rejects.toMatchObject({ kind: 'auth' })
  })

  it('a key change while locked is not kept in memory when it cannot be stored', async () => {
    const { enableLock, lock } = await import('../security/lock')
    const saved = await saveProfile(newProfile({ name: 'P', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', apiKey: 'sk-plain' }))
    await useProvidersStore.getState().load()
    await enableLock('correct horse battery')
    lock()
    await vi.waitFor(() => expect(useProvidersStore.getState().profiles[0]?.keyEncrypted).toBe(true))
    const sealed = useProvidersStore.getState().profiles[0]!.apiKey
    await useProvidersStore.getState().updateProfile(saved.id, { apiKey: 'sk-other' })
    expect(useProvidersStore.getState().profiles[0]!.apiKey).toBe(sealed)
  })
})

it('stores the reasoning effort per model, clears it back to Default, and keeps the connection status', async () => {
  const p = await saveProfile(newProfile({ name: 'OR', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' }))
  await useProvidersStore.getState().load()
  useProvidersStore.getState().setStatus(p.id, 'ok')
  await useProvidersStore.getState().setReasoningEffort(p.id, 'r1', 'high')
  expect(useProvidersStore.getState().profiles[0]!.reasoningEffort).toEqual({ r1: 'high' })
  expect((await getProfile(p.id))?.reasoningEffort).toEqual({ r1: 'high' })
  expect(useProvidersStore.getState().status[p.id]).toBe('ok')
  await useProvidersStore.getState().setReasoningEffort(p.id, 'r1', null)
  expect((await getProfile(p.id))?.reasoningEffort).toEqual({})
})

it('refreshes model lists cached before reasoning support, for Anthropic and OpenRouter only, keeping the status', async () => {
  const stale = await saveProfile({
    ...newProfile({ name: 'OR', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' }),
    cachedModels: [{ id: 'r1' }],
  })
  const fresh = await saveProfile({
    ...newProfile({ name: 'C', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k' }),
    cachedModels: [{ id: 'c1', maxOutputTokens: 64000 }],
  })
  const local = await saveProfile({
    ...newProfile({ name: 'L', adapter: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' }),
    cachedModels: [{ id: 'llama' }],
  })
  await useProvidersStore.getState().load()
  useProvidersStore.getState().setStatus(stale.id, 'ok')
  const listModels = vi.fn(async () => [{ id: 'r1', reasoning: { efforts: true, canDisable: true, adaptive: false } }])
  const create = vi.fn((_p: ProviderProfile) => ({ listModels, streamChat: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true as const, value: undefined }) }) }) }))
  await useProvidersStore.getState().refreshStaleModels(create)
  expect(create.mock.calls.map(([p]) => p.id)).toEqual([stale.id])
  expect((await getProfile(stale.id))?.cachedModels[0]?.reasoning).toEqual({ efforts: true, canDisable: true, adaptive: false })
  expect(useProvidersStore.getState().status[stale.id]).toBe('ok')
  void fresh
  void local
})

it('ignores a failed refresh', async () => {
  await saveProfile({ ...newProfile({ name: 'OR', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' }), cachedModels: [{ id: 'r1' }] })
  await useProvidersStore.getState().load()
  const create = vi.fn(() => ({ listModels: async () => Promise.reject(new Error('offline')), streamChat: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true as const, value: undefined }) }) }) }))
  await expect(useProvidersStore.getState().refreshStaleModels(create)).resolves.toBeUndefined()
})
