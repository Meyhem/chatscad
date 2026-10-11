import { useEffect } from 'react'
import { ExportDialog } from '../export/ExportDialog'
import { usePrefs } from '../settings/prefsStore'
import { listenForShareLinks } from '../share/importShared'
import { ShareNotice } from '../share/ShareNotice'

/** One mount point for M4's app-wide overlays (dialogs, notices, update prompt) and its startup work. */
export function GlobalOverlays() {
  useEffect(() => {
    void usePrefs.getState().load()
  }, [])
  useEffect(() => listenForShareLinks(), [])
  return (
    <>
      <ExportDialog />
      <ShareNotice />
    </>
  )
}
