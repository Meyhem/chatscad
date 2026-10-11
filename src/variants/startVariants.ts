import { createProvider as defaultCreateProvider } from '../ai/createProvider'
import type { LlmProvider } from '../ai/types'
import { useChatStore } from '../chat/chatStore'
import type { ProviderProfile } from '../db/db'
import { currentLibraries, useProjectStore } from '../history/projectStore'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { isEmptyCode, useAppStore } from '../state/store'
import { useVariantStore } from './variantStore'

/** Starts "Generate 3" with the same request sendPrompt() would send for a single reply. Returns false when nothing was sent. */
export function startVariants(text: string, deps: { createProvider?(profile: ProviderProfile): LlmProvider } = {}): boolean {
  const userText = text.trim()
  const providers = useProvidersStore.getState()
  const profile = selectActiveProfile(providers)
  const model = selectActiveModel(providers)
  if (userText === '' || useChatStore.getState().busy || !profile || !model) return false
  const code = useAppStore.getState().code
  const { project, head } = useProjectStore.getState()
  useVariantStore.getState().start({
    provider: (deps.createProvider ?? defaultCreateProvider)(profile),
    profile,
    model,
    history: useChatStore.getState().history,
    userText,
    ctx: { code: isEmptyCode(code) ? '' : code, libraries: currentLibraries() },
    maxFixAttempts: providers.settings.autoFixAttempts,
    projectId: project?.id ?? null,
    parentId: head?.id ?? null,
  })
  return true
}
