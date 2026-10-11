import { useMemo, useRef, type ReactNode } from 'react'
import { ChatPanel } from '../chat/ChatPanel'
import { CustomizerDock } from '../customizer/CustomizerDock'
import { parseCustomizer } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { CodePane } from '../workbench/CodePane'
import { viewPanelId } from '../workbench/ViewTabs'
import { DEFAULT_LAYOUT, LIMITS } from './panelLayout'
import { Splitter } from './Splitter'
import { useElementHeight } from './useElementHeight'
import { useWorkbenchLayout } from './useWorkbenchLayout'

/** Height of the code pane's tab row, above the editor. */
const CODE_HEADER = 40

/** The desktop workbench: chat, 3D view with its parameters, and code, with a resize divider between each. */
export function WorkbenchColumns({ viewer }: { viewer: ReactNode }) {
  const { layout, columns, change, commit } = useWorkbenchLayout()
  const code = useAppStore((s) => s.code)
  const hasParams = useMemo(() => parseCustomizer(code).length > 0, [code])
  const viewColumn = useRef<HTMLElement>(null)
  const codeColumn = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const viewHeight = useElementHeight(viewColumn)
  const codeHeight = useElementHeight(codeColumn)
  const dockHeight = useElementHeight(dock)
  const room = (total: number, extra = 0) => (total > 0 ? Math.max(total - LIMITS.minAbove - extra, 0) : Infinity)
  const dockMax = Math.max(LIMITS.dock[0], Math.min(LIMITS.dock[1], room(viewHeight)))
  const consoleMax = Math.max(LIMITS.console[0], Math.min(LIMITS.console[1], room(codeHeight, CODE_HEADER)))

  return (
    <main
      role="tabpanel"
      id={viewPanelId('workbench')}
      aria-labelledby="view-tab-workbench"
      className="grid min-h-0 flex-1"
      style={{ gridTemplateColumns: `${columns.chatWidth}px 1px minmax(${LIMITS.minViewerWidth}px, 1fr) 1px ${columns.codeWidth}px` }}
    >
      <ChatPanel />
      <Splitter
        orientation="vertical"
        label="Resize chat"
        value={columns.chatWidth}
        min={LIMITS.chat[0]}
        max={LIMITS.chat[1]}
        defaultValue={DEFAULT_LAYOUT.chatWidth}
        onChange={(chatWidth) => change({ chatWidth })}
        onCommit={(chatWidth) => commit({ chatWidth })}
      />

      <section ref={viewColumn} aria-label="3D view" className="flex min-h-0 min-w-0 flex-col">
        <div className="min-h-0 flex-1">{viewer}</div>
        {hasParams && (
          <Splitter
            orientation="horizontal"
            label="Resize parameters"
            invert
            value={Math.min(layout.dockHeight ?? dockHeight, dockMax)}
            min={LIMITS.dock[0]}
            max={dockMax}
            defaultValue={dockHeight}
            onChange={(h) => change({ dockHeight: h })}
            onCommit={(h) => commit({ dockHeight: h })}
            onReset={() => commit({ dockHeight: null })}
          />
        )}
        <div ref={dock} className="flex min-h-0 shrink-0 flex-col">
          <CustomizerDock height={hasParams && layout.dockHeight !== null ? Math.min(layout.dockHeight, dockMax) : null} />
        </div>
      </section>

      <Splitter
        orientation="vertical"
        label="Resize code"
        invert
        value={columns.codeWidth}
        min={LIMITS.code[0]}
        max={LIMITS.code[1]}
        defaultValue={DEFAULT_LAYOUT.codeWidth}
        onChange={(codeWidth) => change({ codeWidth })}
        onCommit={(codeWidth) => commit({ codeWidth })}
      />
      <div ref={codeColumn} className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
        <CodePane
          consoleHeight={Math.min(layout.consoleHeight, consoleMax)}
          consoleDivider={
            <Splitter
              orientation="horizontal"
              label="Resize console"
              invert
              value={Math.min(layout.consoleHeight, consoleMax)}
              min={LIMITS.console[0]}
              max={consoleMax}
              defaultValue={DEFAULT_LAYOUT.consoleHeight}
              onChange={(consoleHeight) => change({ consoleHeight })}
              onCommit={(consoleHeight) => commit({ consoleHeight })}
            />
          }
        />
      </div>
    </main>
  )
}
