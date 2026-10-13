import { useMemo, useRef, type ReactNode } from 'react'
import { ChatPanel } from '../chat/ChatPanel'
import { CustomizerDock } from '../customizer/CustomizerDock'
import { parseCustomizer } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { CodePane } from '../workbench/CodePane'
import { viewPanelId } from '../workbench/ViewTabs'
import { columnMax, DEFAULT_LAYOUT, LIMITS, resizeColumn } from './panelLayout'
import { Splitter } from './Splitter'
import { useElementHeight } from './useElementHeight'
import { useWorkbenchLayout } from './useWorkbenchLayout'

/** Height of the code pane's tab row, above the editor. */
const CODE_HEADER = 40

/** The desktop workbench: chat, 3D view with its parameters, and code, with a resize divider between each. */
export function WorkbenchColumns({ viewer }: { viewer: ReactNode }) {
  const { layout, columns, windowWidth, change, commit } = useWorkbenchLayout()
  const chatTo = (v: number) => resizeColumn('chat', v, windowWidth, columns)
  const codeTo = (v: number) => resizeColumn('code', v, windowWidth, columns)
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
      // The 3D view may shrink below its usual minimum in a narrow window, so the columns never overflow it.
      style={{ gridTemplateColumns: `${columns.chatWidth}px 1px minmax(0, 1fr) 1px ${columns.codeWidth}px` }}
    >
      <ChatPanel />
      <Splitter
        orientation="vertical"
        label="Resize agent"
        value={columns.chatWidth}
        min={LIMITS.chat[0]}
        max={columnMax('chat', windowWidth)}
        defaultValue={DEFAULT_LAYOUT.chatWidth}
        onChange={(v) => change(chatTo(v))}
        onCommit={(v) => commit(chatTo(v))}
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
        max={columnMax('code', windowWidth)}
        defaultValue={DEFAULT_LAYOUT.codeWidth}
        onChange={(v) => change(codeTo(v))}
        onCommit={(v) => commit(codeTo(v))}
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
