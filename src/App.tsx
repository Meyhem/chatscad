import { useEffect, useMemo } from 'react'
import { GlobalOverlays } from './app/GlobalOverlays'
import { ChatPanel } from './chat/ChatPanel'
import { ComposerBridge } from './chat/promptRequest'
import { CustomizerDock } from './customizer/CustomizerDock'
import { KeyRow } from './editor/KeyRow'
import { ExportButtons, exportDisabledReason } from './export/ExportButtons'
import { useExportStore } from './export/exportStore'
import { exportStl } from './export/saveFile'
import { GalleryView } from './gallery/GalleryView'
import { HistoryView } from './history/HistoryView'
import { useProjectStore } from './history/projectStore'
import { useRenderedVersionLabel } from './history/renderedVersion'
import { PhoneLayout } from './layout/PhoneLayout'
import { WorkbenchColumns } from './layout/WorkbenchColumns'
import { useIsPhone } from './layout/useIsPhone'
import { createRenderWorker, type WorkerFactory } from './render/createRenderWorker'
import { onLoadProgress } from './render/loadProgress'
import { withPreviewPass } from './render/previewPass'
import { showPreviewIfCurrent } from './render/showPreview'
import { useRenderLoop } from './render/useRenderLoop'
import { useRefineSync } from './refine/useRefineSync'
import { SettingsPage } from './settings/SettingsPage'
import { useProvidersStore } from './settings/providersStore'
import { usePrefs } from './settings/prefsStore'
import { useSettingsStore } from './settings/settingsStore'
import { selectCanExport, selectDisplayMesh, selectShowingPreview, useAppStore } from './state/store'
import { BrandTitle } from './ui/BrandTitle'
import { DimsReadout } from './ui/DimsReadout'
import { IconDownload, IconShare } from './ui/icons'
import { StatusPill } from './ui/StatusPill'
import { VariantProgressPill } from './variants/VariantProgressPill'
import { Viewer } from './viewer/Viewer'
import { CodePane } from './workbench/CodePane'
import { HistoryControls } from './workbench/HistoryControls'
import { NoProjectCard } from './workbench/NoProjectCard'
import { ViewTabs } from './workbench/ViewTabs'
import { ProjectMenu } from './workbench/ProjectMenu'
import { RenderedFromCaption } from './workbench/RenderedFromCaption'
import { useUndoShortcuts } from './workbench/useUndoShortcuts'

export function App({ createWorker = createRenderWorker }: { createWorker?: WorkerFactory }) {
  const debounceMs = useSettingsStore((s) => s.settings.debounceMs)
  const timeoutMs = useSettingsStore((s) => s.settings.timeoutMs)
  const renderWorker = useMemo(
    () =>
      withPreviewPass(createWorker, {
        enabled: () => usePrefs.getState().lowQualityPreview,
        onPreview: (result, req) => showPreviewIfCurrent(req, result.mesh),
      }),
    [createWorker],
  )
  useRenderLoop(renderWorker, debounceMs, timeoutMs)
  useRefineSync()
  const displayMesh = useAppStore(selectDisplayMesh)
  const previewing = useAppStore(selectShowingPreview)
  useUndoShortcuts()
  useEffect(() => {
    void useProvidersStore
      .getState()
      .load()
      .then(() => useProvidersStore.getState().refreshStaleModels())
  }, [])
  useEffect(() => onLoadProgress(useAppStore.getState().setLoadProgress), [])
  const loadProgress = useAppStore((s) => s.loadProgress)
  const view = useAppStore((s) => s.view)
  const goToLine = useAppStore((s) => s.goToLine)
  const status = useAppStore((s) => s.status)
  const mesh = useAppStore((s) => s.mesh)
  const diagnostics = useAppStore((s) => s.diagnostics)
  const error = useAppStore((s) => s.error)
  const renderMs = useAppStore((s) => s.renderMs)
  const canExportStl = useAppStore(selectCanExport)
  const staleLabel = useRenderedVersionLabel()
  const isPhone = useIsPhone()
  const insertText = useAppStore((s) => s.insertText)
  const hasProject = useProjectStore((s) => s.project !== null)

  if (view === 'gallery') return <GalleryView />

  const bounds = mesh?.bounds ?? null
  const stale = status === 'error' && mesh !== null

  // Phones put the Project / History / Settings tabs under the header; the Project tab adds the Chat / Code / 3D panels.
  const phoneHeader = isPhone && (
    <>
      <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b border-line bg-panel pr-2 pl-4">
        <div className="flex min-w-0 flex-1">
          <ProjectMenu />
        </div>
        {hasProject && (
          <StatusPill status={status} renderMs={renderMs} error={error} diagnostics={diagnostics} onGoToLine={goToLine} loadProgress={loadProgress} />
        )}
        <button
          type="button"
          className="pc-btn is-icon is-ghost"
          aria-label="Share"
          disabled={status === 'empty' || !hasProject}
          onClick={() => useExportStore.getState().openAt('link')}
        >
          <IconShare className="pc-i" aria-hidden="true" />
        </button>
        <button type="button" className="pc-btn is-icon is-ghost" aria-label="Export STL" onClick={() => useExportStore.getState().openAt('model')}>
          <IconDownload className="pc-i" aria-hidden="true" />
        </button>
      </header>
      <div className="shrink-0 border-b border-line bg-panel px-3 py-2">
        <ViewTabs fill />
      </div>
    </>
  )

  if (isPhone && (view !== 'workbench' || !hasProject)) {
    return (
      <div className="pc-root flex h-full flex-col bg-bg text-ink">
        {phoneHeader}
        {view === 'settings' ? <SettingsPage /> : view === 'history' ? <HistoryView createWorker={createWorker} /> : <NoProjectCard />}
        <ComposerBridge />
        <GlobalOverlays />
      </div>
    )
  }

  if (isPhone) {
    return (
      <PhoneLayout
        header={phoneHeader}
        chat={<ChatPanel />}
        code={<CodePane />}
        keyRow={<KeyRow onInsert={insertText} />}
        viewer={(paused) => <Viewer mesh={displayMesh} stale={stale} thumbnails staleLabel={staleLabel} previewing={previewing} empty={status === 'empty'} paused={paused} refine />}
        params={<CustomizerDock />}
        overlays={
          <>
            <ComposerBridge />
            <GlobalOverlays />
          </>
        }
      />
    )
  }

  return (
    <div className="pc-root flex h-full flex-col bg-bg text-ink">
      <header className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-line bg-panel pl-4 pr-3">
        <BrandTitle />
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        <ProjectMenu />
        <ViewTabs />
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        {view === 'workbench' && hasProject && (
          <>
            <StatusPill status={status} renderMs={renderMs} error={error} diagnostics={diagnostics} onGoToLine={goToLine} loadProgress={loadProgress} />
            <VariantProgressPill />
            {/* The viewer shows the dims too, so the header copy gives way on narrow screens. */}
            {bounds && (
              <span className="hidden xl:contents">
                <DimsReadout bounds={bounds} />
              </span>
            )}
            {stale && <RenderedFromCaption />}
          </>
        )}
        {view === 'history' && hasProject && (
          <StatusPill status={status} renderMs={renderMs} error={error} diagnostics={diagnostics} onGoToLine={goToLine} loadProgress={loadProgress} />
        )}
        {view === 'settings' && <span className="pc-caption">Applies to every project</span>}
        <span className="flex-1" />
        {view === 'workbench' && hasProject && (
          <>
            <HistoryControls />
            <span aria-hidden="true" className="h-5 w-px bg-line" />
          </>
        )}
        <ExportButtons
          canExportStl={canExportStl}
          canShare={status !== 'empty' && hasProject}
          disabledReason={exportDisabledReason(canExportStl ? 'ok' : status === 'ok' ? 'rendering' : status)}
          onExportStl={() => {
            const { stl } = useAppStore.getState()
            if (stl) void exportStl(stl)
          }}
          onShare={() => useExportStore.getState().openAt('link')}
        />
      </header>

      {view === 'settings' && <SettingsPage />}
      {view === 'history' && <HistoryView createWorker={createWorker} />}
      {view === 'workbench' && !hasProject && <NoProjectCard />}

      {/* Stays mounted while settings or history is open, so the editor's undo history and the camera survive. */}
      <div data-testid="workbench" hidden={view !== 'workbench' || !hasProject} className="flex min-h-0 flex-1 flex-col">
        <WorkbenchColumns
          viewer={<Viewer mesh={displayMesh} stale={stale} thumbnails staleLabel={staleLabel} previewing={previewing} empty={status === 'empty'} refine />}
        />
      </div>

      <ComposerBridge />
      <GlobalOverlays />
    </div>
  )
}
