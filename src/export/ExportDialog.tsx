import type { ComponentType } from 'react'
import { IconX } from '../ui/icons'
import { Modal } from '../ui/Modal'
import { useExportStore, type ExportTab } from './exportStore'
import { LinkTab } from './tabs/LinkTab'
import { ModelFileTab } from './tabs/ModelFileTab'

/** In the screen's order; Tasks 10 and 11 insert Image, Turntable and Timelapse before Link. */
export const TABS: Array<{ id: ExportTab; label: string; Panel: ComponentType }> = [
  { id: 'model', label: 'Model file', Panel: ModelFileTab },
  { id: 'link', label: 'Link', Panel: LinkTab },
]

export function ExportDialog() {
  const open = useExportStore((s) => s.open)
  const tab = useExportStore((s) => s.tab)
  const setTab = useExportStore((s) => s.setTab)
  const close = useExportStore((s) => s.close)
  if (!open) return null
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <Modal labelledBy="export-title" onClose={close} className="pc-dialog max-w-[920px] gap-0 overflow-hidden p-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-4">
        <h2 id="export-title" className="flex-1">
          Export and share
        </h2>
        <button type="button" className="pc-btn is-icon is-ghost" aria-label="Close" onClick={close}>
          <IconX className="pc-i" aria-hidden="true" />
        </button>
      </div>
      <div className="overflow-x-auto px-6">
        <div className="pc-tabs" role="tablist" aria-label="Export format">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`export-tab-${t.id}`}
              aria-selected={t.id === active.id}
              aria-controls="export-panel"
              className="pc-tab"
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div id="export-panel" role="tabpanel" aria-labelledby={`export-tab-${active.id}`}>
        <active.Panel />
      </div>
    </Modal>
  )
}
