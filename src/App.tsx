import { useEffect } from 'react'
import { ChatPanel } from './chat/ChatPanel'
import { ComposerBridge } from './chat/promptRequest'
import { CustomizerDock } from './customizer/CustomizerDock'
import { ExportButtons, exportDisabledReason } from './export/ExportButtons'
import { exportScad, exportStl } from './export/saveFile'
import { GalleryView } from './gallery/GalleryView'
import { HistoryView } from './history/HistoryView'
import { useRenderedVersionLabel } from './history/renderedVersion'
import { createRenderWorker, type WorkerFactory } from './render/createRenderWorker'
import { useRenderLoop } from './render/useRenderLoop'
import { SettingsPage } from './settings/SettingsPage'
import { useProvidersStore } from './settings/providersStore'
import { useSettingsStore } from './settings/settingsStore'
import { selectCanExport, useAppStore } from './state/store'
import { DimsReadout } from './ui/DimsReadout'
import { IconSettings } from './ui/icons'
import { StatusPill } from './ui/StatusPill'
import { Viewer } from './viewer/Viewer'
import { CodePane } from './workbench/CodePane'
import { HistoryControls } from './workbench/HistoryControls'
import { ProjectMenu } from './workbench/ProjectMenu'
import { RenderedFromCaption } from './workbench/RenderedFromCaption'
import { useUndoShortcuts } from './workbench/useUndoShortcuts'

export function App({ createWorker = createRenderWorker }: { createWorker?: WorkerFactory }) {
  const debounceMs = useSettingsStore((s) => s.settings.debounceMs)
  const timeoutMs = useSettingsStore((s) => s.settings.timeoutMs)
  useRenderLoop(createWorker, debounceMs, timeoutMs)
  useUndoShortcuts()
  useEffect(() => {
    void useProvidersStore.getState().load()
  }, [])
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const goToLine = useAppStore((s) => s.goToLine)
  const status = useAppStore((s) => s.status)
  const mesh = useAppStore((s) => s.mesh)
  const diagnostics = useAppStore((s) => s.diagnostics)
  const error = useAppStore((s) => s.error)
  const renderMs = useAppStore((s) => s.renderMs)
  const canExportStl = useAppStore(selectCanExport)
  const staleLabel = useRenderedVersionLabel()

  if (view === 'gallery') return <GalleryView />

  const bounds = mesh?.bounds ?? null
  const stale = status === 'error' && mesh !== null

  return (
    <div className="pc-root flex h-full flex-col bg-bg text-ink">
      {view === 'settings' && <SettingsPage />}

      {/* Stays mounted while settings or history is open, so the editor's undo history and the camera survive. */}
      <div data-testid="workbench" hidden={view === 'settings'} className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-line bg-panel pl-4 pr-3">
          <h1 className="text-[15px] font-bold tracking-tight">PromptCAD</h1>
          <span aria-hidden="true" className="h-5 w-px bg-line" />
          <ProjectMenu />
          <StatusPill status={status} renderMs={renderMs} error={error} diagnostics={diagnostics} onGoToLine={goToLine} />
          {bounds && <DimsReadout bounds={bounds} />}
          {stale && <RenderedFromCaption />}
          <span className="flex-1" />
          <HistoryControls />
          <button
            type="button"
            className="pc-btn is-ghost is-sm is-icon"
            aria-label="Settings"
            title="Settings"
            onClick={() => setView('settings')}
          >
            <IconSettings className="pc-i" aria-hidden="true" />
          </button>
          <ExportButtons
            canExportStl={canExportStl}
            disabledReason={exportDisabledReason(canExportStl ? 'ok' : status === 'ok' ? 'rendering' : status)}
            onExportStl={() => {
              const { stl } = useAppStore.getState()
              if (stl) void exportStl(stl)
            }}
            onExportScad={() => void exportScad(useAppStore.getState().code)}
          />
        </header>

        {view === 'history' && <HistoryView createWorker={createWorker} />}

        <main
          hidden={view !== 'workbench'}
          className="grid min-h-0 flex-1 grid-rows-[repeat(3,minmax(0,1fr))] md:grid-cols-[360px_minmax(0,1fr)_440px] md:grid-rows-1"
        >
          <ChatPanel />

          <section aria-label="3D view" className="flex min-h-0 min-w-0 flex-col md:border-l md:border-line">
            <div className="min-h-0 flex-1">
              <Viewer mesh={mesh} stale={stale} thumbnails staleLabel={staleLabel} />
            </div>
            <CustomizerDock />
          </section>

          <CodePane />
        </main>
      </div>

      <ComposerBridge />
    </div>
  )
}
