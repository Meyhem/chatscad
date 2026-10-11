import { useEffect } from 'react'
import { ExportDialog } from '../export/ExportDialog'
import { UpdatePrompt } from '../pwa/UpdatePrompt'
import { usePwaUpdate } from '../pwa/usePwaUpdate'
import { usePrefs } from '../settings/prefsStore'
import { listenForShareLinks } from '../share/importShared'
import { ShareNotice } from '../share/ShareNotice'
import { VariantPicker } from '../variants/VariantPicker'

/** One mount point for M4's app-wide overlays (dialogs, notices, update prompt) and its startup work. */
export function GlobalOverlays() {
  const pwa = usePwaUpdate()
  useEffect(() => {
    void usePrefs.getState().load()
  }, [])
  useEffect(() => listenForShareLinks(), [])
  return (
    <>
      <VariantPicker />
      <ExportDialog />
      <ShareNotice />
      <UpdatePrompt needRefresh={pwa.needRefresh} onReload={pwa.reload} onDismiss={pwa.dismiss} />
    </>
  )
}
