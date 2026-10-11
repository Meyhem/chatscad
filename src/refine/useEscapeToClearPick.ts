import { useEffect } from 'react'
import { useRefineStore } from './refineStore'

export function useEscapeToClearPick(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useRefineStore.getState().pick === null) return
      if (e.target instanceof Element && e.target.closest('.cm-editor')) return
      useRefineStore.getState().setPick(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
