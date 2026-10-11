import { useEffect } from 'react'
import { useAppStore } from '../state/store'
import { useRefineStore } from './refineStore'

/** A pick belongs to one code and one mesh; any change to either clears it (and with it the chip and highlights). */
export function useRefineSync(): void {
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.code !== prev.code || state.mesh !== prev.mesh) useRefineStore.getState().setPick(null)
      }),
    [],
  )
}
