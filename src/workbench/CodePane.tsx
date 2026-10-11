import { useEffect, useState } from 'react'
import { CodeEditor } from '../editor/CodeEditor'
import { matchesHead } from '../history/matchesHead'
import { useProjectStore } from '../history/projectStore'
import { flushRecorder } from '../history/recorder'
import { versionCaption } from '../history/sources'
import { ConsolePanel } from '../panels/ConsolePanel'
import { engineLabel, loadEngineVersion } from '../render/engineVersion'
import { useAppStore } from '../state/store'
import { problemItems, ProblemsPanel } from './ProblemsPanel'

export function CodePane({ actions }: { actions?: React.ReactNode }) {
  const code = useAppStore((s) => s.code)
  const params = useAppStore((s) => s.params)
  const setCode = useAppStore((s) => s.setCode)
  const goToLine = useAppStore((s) => s.goToLine)
  const reveal = useAppStore((s) => s.reveal)
  const status = useAppStore((s) => s.status)
  const logs = useAppStore((s) => s.logs)
  const diagnostics = useAppStore((s) => s.diagnostics)
  const error = useAppStore((s) => s.error)
  const renderMs = useAppStore((s) => s.renderMs)
  const head = useProjectStore((s) => s.head)
  const [tab, setTab] = useState<'code' | 'problems'>('code')
  const [engine, setEngine] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadEngineVersion().then((v) => live && setEngine(v))
    return () => {
      live = false
    }
  }, [])

  const problems = problemItems(status, error, diagnostics)
  const hasError = problems.some((p) => p.severity === 'error')
  const caption = versionCaption(head, head !== null && !matchesHead(code, params, head))

  return (
    <section aria-label="Code" className="flex min-h-0 min-w-0 flex-col border-t border-line bg-panel md:border-t-0 md:border-l">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="pc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'code'} className="pc-tab" onClick={() => setTab('code')}>
            main.scad
          </button>
          <button type="button" role="tab" aria-selected={tab === 'problems'} className="pc-tab" onClick={() => setTab('problems')}>
            Problems
            {problems.length > 0 && <span className={`pc-mono ${hasError ? 'text-error' : 'text-warn'}`}>{problems.length}</span>}
          </button>
        </div>
        <span className="flex-1" />
        {caption && (
          <span className="pc-caption" data-testid="version-caption">
            {caption}
          </span>
        )}
        {actions}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={tab === 'code' ? 'h-full' : 'hidden'}>
          <CodeEditor value={code} onChange={setCode} diagnostics={diagnostics} reveal={reveal} onBlur={flushRecorder} />
        </div>
        {tab === 'problems' && (
          <ProblemsPanel
            items={problems}
            onGoToLine={(line) => {
              setTab('code')
              goToLine(line)
            }}
          />
        )}
      </div>
      <div className="h-44 shrink-0 border-t border-line">
        <ConsolePanel status={status} logs={logs} error={error} renderMs={renderMs} onGoToLine={goToLine} engineLabel={engineLabel(engine)} />
      </div>
    </section>
  )
}
