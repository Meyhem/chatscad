type Flag = [boolean, (value: boolean) => void]

/** Vitest stand-in for virtual:pwa-register/react: no service worker, no update waiting. */
export function useRegisterSW(): { needRefresh: Flag; offlineReady: Flag; updateServiceWorker(reload?: boolean): Promise<void> } {
  return { needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }
}
