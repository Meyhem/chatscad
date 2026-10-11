import type { ReactNode } from 'react'
import { selectCanExport, useAppStore } from '../../state/store'
import { IconDownload } from '../../ui/icons'
import { exportDisabledReason } from '../ExportButtons'
import { exportScad, exportStl } from '../saveFile'

function FileRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-line bg-inset p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold">{title}</span>
        <span className="pc-caption">{hint}</span>
      </div>
      {children}
    </div>
  )
}

export function ModelFileTab() {
  const canExportStl = useAppStore(selectCanExport)
  const status = useAppStore((s) => s.status)
  const reason = canExportStl ? null : exportDisabledReason(status === 'ok' ? 'rendering' : status)
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <FileRow title="STL (binary)" hint={reason ?? 'For slicers. Matches the code and parameter values on screen.'}>
        <button
          type="button"
          className="pc-btn is-primary"
          disabled={!canExportStl}
          title={reason ?? undefined}
          onClick={() => {
            const { stl } = useAppStore.getState()
            if (stl) void exportStl(stl)
          }}
        >
          <IconDownload className="pc-i" aria-hidden="true" />
          Export STL
        </button>
      </FileRow>
      <FileRow title="OpenSCAD source (.scad)" hint="The code as it is in the editor.">
        <button type="button" className="pc-btn" onClick={() => void exportScad(useAppStore.getState().code)}>
          Export .scad
        </button>
      </FileRow>
    </div>
  )
}
