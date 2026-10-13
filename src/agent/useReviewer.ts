import { useMemo } from 'react'
import { useChatStore } from '../chat/chatStore'
import { useAgentStore } from './agentStore'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { useSettingsStore } from '../settings/settingsStore'
import { selectReviewer, type ReviewerChoice } from './reviewer'

/** The builder or the agent is working: card actions wait. */
export function useAgentBusy(): boolean {
  const agent = useAgentStore((s) => s.busy !== null)
  const chat = useChatStore((s) => s.busy)
  return agent || chat
}

/** The reviewer for the current profiles and settings; follows changes to both. */
export function useReviewer(): ReviewerChoice | null {
  const profiles = useProvidersStore((s) => s.profiles)
  const activeProfile = useProvidersStore(selectActiveProfile)
  const activeModel = useProvidersStore(selectActiveModel)
  const reviewProfileId = useSettingsStore((s) => s.settings.reviewProfileId)
  const reviewModel = useSettingsStore((s) => s.settings.reviewModel)
  return useMemo(
    () => selectReviewer({ profiles, activeProfile, activeModel, reviewProfileId, reviewModel }),
    [profiles, activeProfile, activeModel, reviewProfileId, reviewModel],
  )
}
