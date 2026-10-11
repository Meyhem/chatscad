import { selectActiveProfile, useProvidersStore } from '../settings/providersStore'

/** Whether the active provider profile can take images; follows profile and settings changes. */
export function useVisionSupport(): boolean {
  return useProvidersStore((s) => selectActiveProfile(s)?.capabilities.vision ?? false)
}
