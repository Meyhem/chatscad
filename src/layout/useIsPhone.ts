import { useSyncExternalStore } from 'react'

/** Below Tailwind's md breakpoint (48rem). */
export const PHONE_QUERY = '(max-width: 767.98px)'

function query(): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const list = query()
  list?.addEventListener('change', onChange)
  return () => list?.removeEventListener('change', onChange)
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false)
}
