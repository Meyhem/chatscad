import { useEffect } from 'react'
import { usePrefs } from '../settings/prefsStore'

/** One mount point for M4's app-wide overlays (dialogs, notices, update prompt) and its startup work. */
export function GlobalOverlays() {
  useEffect(() => {
    void usePrefs.getState().load()
  }, [])
  return null
}
