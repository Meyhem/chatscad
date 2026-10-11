import type { LlmProvider } from '../ai/types'
import { DEFAULT_SETTINGS } from '../db/db'
import { newProfile } from '../db/profiles'
import { useChatStore } from '../chat/chatStore'
import { useProvidersStore } from '../settings/providersStore'
import { useAppStore } from '../state/store'
import { startVariants } from './startVariants'
import { useVariantStore } from './variantStore'

const profile = newProfile({ name: 'P', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', defaultModel: 'm1' })
const provider: LlmProvider = { listModels: async () => [], async *streamChat() {} }

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useChatStore.setState({ ...useChatStore.getInitialState(), history: [{ role: 'user', content: 'earlier' }] }, true)
  useProvidersStore.setState(
    { ...useProvidersStore.getInitialState(), loaded: true, profiles: [profile], settings: { ...DEFAULT_SETTINGS, autoFixAttempts: 1 } },
    true,
  )
})

it('starts three variants with the request the chat would send: model, history, code and auto-fix attempts', () => {
  const start = vi.fn()
  useVariantStore.setState({ start })
  useAppStore.getState().setCode('cube(3);')
  expect(startVariants('  A hook  ', { createProvider: () => provider })).toBe(true)
  expect(start).toHaveBeenCalledOnce()
  expect(start.mock.calls[0][0]).toMatchObject({
    provider,
    profile,
    model: 'm1',
    history: [{ role: 'user', content: 'earlier' }],
    userText: 'A hook',
    ctx: { code: 'cube(3);' },
    maxFixAttempts: 1,
  })
})

it('sends an empty editor for whitespace-only code, and does nothing without text or a model', () => {
  const start = vi.fn()
  useVariantStore.setState({ start })
  useAppStore.setState({ code: '  \n' })
  expect(startVariants('A hook', { createProvider: () => provider })).toBe(true)
  expect(start.mock.calls[0][0].ctx.code).toBe('')
  expect(startVariants('   ', { createProvider: () => provider })).toBe(false)
  useProvidersStore.setState({ profiles: [] })
  expect(startVariants('A hook', { createProvider: () => provider })).toBe(false)
  expect(start).toHaveBeenCalledOnce()
})
