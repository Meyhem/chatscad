import { CodeEditor } from './editor/CodeEditor'
import { ExportButtons, exportDisabledReason } from './export/ExportButtons'
import { exportScad, exportStl } from './export/saveFile'
import { ConsolePanel } from './panels/ConsolePanel'
import { createRenderWorker, type WorkerFactory } from './render/createRenderWorker'
import { useRenderLoop } from './render/useRenderLoop'
import { selectCanExport, useAppStore } from './state/store'
import { DimsReadout } from './ui/DimsReadout'
import { StatusPill } from './ui/StatusPill'
import { Viewer } from './viewer/Viewer'

export function App({ createWorker = createRenderWorker }: { createWorker?: WorkerFactory }) {
  useRenderLoop(createWorker)
  const code = useAppStore((s) => s.code)
  const setCode = useAppStore((s) => s.setCode)
  const goToLine = useAppStore((s) => s.goToLine)
  const reveal = useAppStore((s) => s.reveal)
  const status = useAppStore((s) => s.status)
  const mesh = useAppStore((s) => s.mesh)
  const logs = useAppStore((s) => s.logs)
  const diagnostics = useAppStore((s) => s.diagnostics)
  const error = useAppStore((s) => s.error)
  const renderMs = useAppStore((s) => s.renderMs)
  const canExportStl = useAppStore(selectCanExport)

  const bounds = mesh?.bounds ?? null
  const stale = status === 'error' && mesh !== null

  return (
    <div className="pc-root flex h-full flex-col bg-bg text-ink">
      <header className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-line bg-panel pl-4 pr-3">
        <h1 className="text-[15px] font-bold tracking-tight">PromptCAD</h1>
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        <StatusPill status={status} renderMs={renderMs} error={error} diagnostics={diagnostics} onGoToLine={goToLine} />
        {bounds && <DimsReadout bounds={bounds} />}
        {stale && <span className="pc-caption">last model that compiled</span>}
        <span className="flex-1" />
        <ExportButtons
          canExportStl={canExportStl}
          disabledReason={exportDisabledReason(status)}
          onExportStl={() => {
            const { stl } = useAppStore.getState()
            if (stl) void exportStl(stl)
          }}
          onExportScad={() => void exportScad(useAppStore.getState().code)}
        />
      </header>

      <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_440px] md:grid-rows-1">
        <section aria-label="3D view" className="min-h-0 min-w-0">
          <Viewer mesh={mesh} stale={stale} />
        </section>

        <section
          aria-label="Code"
          className="flex min-h-0 min-w-0 flex-col border-t border-line bg-panel md:border-t-0 md:border-l"
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
            <div className="pc-tabs" role="tablist">
              <button type="button" role="tab" aria-selected="true" className="pc-tab">
                main.scad
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor value={code} onChange={setCode} diagnostics={diagnostics} reveal={reveal} />
          </div>
          <div className="h-44 shrink-0 border-t border-line">
            <ConsolePanel status={status} logs={logs} error={error} renderMs={renderMs} onGoToLine={goToLine} />
          </div>
        </section>
      </main>
    </div>
  )
}
