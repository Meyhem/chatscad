/// <reference types="vite-plugin-pwa/react" />
import { useRegisterSW } from 'virtual:pwa-register/react'

/** Registers the service worker and reports when a new version is waiting; never reloads on its own. */
export function usePwaUpdate(): { needRefresh: boolean; reload(): void; dismiss(): void } {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  return {
    needRefresh,
    reload: () => void updateServiceWorker(true),
    dismiss: () => setNeedRefresh(false),
  }
}
