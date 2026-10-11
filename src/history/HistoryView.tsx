import { Fragment, useEffect, useMemo, useState } from 'react'
import { messagesForVersion } from '../db/messages'
import { usageForVersion } from '../db/usageLinks'
import type { WorkerFactory } from '../render/createRenderWorker'
import { effectiveValues } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { viewPanelId } from '../workbench/ViewTabs'
import { formatCost, formatTokens } from '../ui/format'
import { IconRestore, IconX } from '../ui/icons'
import { Viewer } from '../viewer/Viewer'
import { sideBySide } from './diff'
import { DiffView } from './DiffView'
import { describeParamChanges } from './messages'
import { saveProjectFile } from './projectFile'
import { useProjectStore } from './projectStore'
import { SOURCE_ICON, SOURCE_NAME } from './sources'
import { buildTimeline, formatAge, timelineCaption } from './timeline'
import { usePreviewRender } from './usePreviewRender'
import { VersionThumb } from './VersionThumb'

interface Details {
  reply: string | null
  tokens: number
  cost: number | null
}

const NO_DETAILS: Details = { reply: null, tokens: 0, cost: null }

export function HistoryView({ createWorker }: { createWorker: WorkerFactory }) {
  const project = useProjectStore((s) => s.project)
  const versions = useProjectStore((s) => s.versions)
  const head = useProjectStore((s) => s.head)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [details, setDetails] = useState<Details>(NO_DETAILS)

  const timeline = useMemo(() => buildTimeline(versions, head?.id ?? null), [versions, head])
  const find = (id: string | null) => (id ? versions.find((v) => v.id === id) : undefined)
  const selected = find(selectedId) ?? head
  const to = find(toId) ?? selected
  const from = find(fromId) ?? find(to?.parentId ?? null) ?? to
  const diff = useMemo(() => (from && to ? sideBySide(from.code, to.code) : null), [from, to])
  const paramChange =
    from && to && from.id !== to.id ? describeParamChanges(effectiveValues(from.code, from.params), effectiveValues(to.code, to.params)) : null
  const preview = usePreviewRender(createWorker, selected ?? null, project?.enabledLibraries ?? [])

  useEffect(() => {
    setDetails(NO_DETAILS)
    if (!selected) return
    let live = true
    void Promise.all([messagesForVersion(selected.id), usageForVersion(selected.id)]).then(([messages, usage]) => {
      if (!live) return
      const reply = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? null
      const tokens = usage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0)
      const known = usage.filter((u) => u.cost !== null)
      setDetails({ reply, tokens, cost: known.length > 0 ? known.reduce((n, u) => n + u.cost!, 0) : null })
    })
    return () => {
      live = false
    }
  }, [selected?.id])

  if (!project || !selected) {
    return (
      <p role="tabpanel" id={viewPanelId('history')} aria-labelledby="view-tab-history" className="pc-caption p-6">
        Open a project to see its versions.
      </p>
    )
  }

  const now = Date.now()
  const isHead = selected.id === head?.id
  const age = formatAge(now - selected.createdAt)
  const meta = [
    selected.model,
    age === 'now' ? 'just now' : `${age} ago`,
    selected.renderMs !== null ? `rendered in ${Math.round(selected.renderMs)} ms` : null,
    details.tokens > 0 ? `${formatTokens(details.tokens)} · ${formatCost(details.cost)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const select = (id: string) => {
    setSelectedId(id)
    setFromId(null)
    setToId(null)
  }
  const leave = () => useAppStore.getState().setView('workbench')

  return (
    <main
      role="tabpanel"
      id={viewPanelId('history')}
      aria-labelledby="view-tab-history"
      className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-[360px_minmax(0,1fr)_400px] md:overflow-hidden">
      <section aria-label="Versions" className="flex min-h-0 min-w-0 flex-col bg-panel">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="pc-label">Versions</span>
          <span className="flex-1" />
          <span className="pc-caption">{timelineCaption(timeline)}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-2">
          {timeline.rows.map(({ version, branch, isHead: current, variantsNotPicked }) => {
            const Icon = SOURCE_ICON[version.source]
            const failed = version.compileStatus === 'error'
            return (
              <Fragment key={version.id}>
                <button
                  type="button"
                  className={`pc-version${failed ? ' is-failed' : ''}${branch ? ' is-branch' : ''}`}
                  aria-current={version.id === selected.id ? 'true' : undefined}
                  onClick={() => select(version.id)}
                >
                  <VersionThumb version={version} />
                  <span className="pc-version-text">
                    <span className="t">
                      <Icon className="pc-i" aria-hidden="true" />
                      {version.label}
                      {current ? ' · current' : ''}
                    </span>
                    <span className="m">{failed ? `Failed · ${version.message}` : version.message}</span>
                  </span>
                  <span className="pc-caption">{formatAge(now - version.createdAt)}</span>
                </button>
                {variantsNotPicked > 0 && (
                  <span className="pc-caption pl-[68px]">
                    + {variantsNotPicked} variant{variantsNotPicked === 1 ? '' : 's'} not picked
                  </span>
                )}
              </Fragment>
            )
          })}
        </div>
        <div className="pc-row shrink-0 border-t border-line p-3">
          <button type="button" className="pc-btn is-sm flex-1" onClick={() => void saveProjectFile(project.id)}>
            Export project (.json)
          </button>
        </div>
      </section>

      <section aria-label="Compare" className="flex min-h-0 min-w-0 flex-col border-line bg-panel md:border-l">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="pc-label">Compare</span>
          <select className="pc-select h-(--control-sm) text-[13px]" aria-label="From version" value={from?.id ?? ''} onChange={(e) => setFromId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="pc-muted">→</span>
          <select className="pc-select h-(--control-sm) text-[13px]" aria-label="To version" value={to?.id ?? ''} onChange={(e) => setToId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="flex-1" />
          <span className="pc-caption pc-mono text-ok" data-testid="diff-added">
            +{diff?.added ?? 0}
          </span>
          <span className="pc-caption pc-mono text-error" data-testid="diff-removed">
            −{diff?.removed ?? 0}
          </span>
        </div>
        {paramChange && paramChange !== 'Parameters unchanged' && (
          <p className="pc-caption border-b border-line px-3 py-2" data-testid="param-diff">
            Parameters: {paramChange}
          </p>
        )}
        {diff && <DiffView rows={diff.rows} />}
      </section>

      <section aria-label="Preview" className="flex min-h-0 min-w-0 flex-col overflow-auto border-line bg-panel md:border-l">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="pc-label">Preview · {selected.label}</span>
          <span className="flex-1" />
          <span className="pc-caption">{isHead ? 'current version' : 'not the current version'}</span>
        </div>
        <div className="h-80 shrink-0">
          <Viewer mesh={preview.mesh} stale={false} />
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="pc-stack gap-1">
            <span className="font-semibold">
              {selected.label} · {SOURCE_NAME[selected.source]}
            </span>
            <span className="pc-caption" data-testid="preview-meta">
              {meta}
            </span>
          </div>
          {preview.status === 'error' && (
            <div className="pc-callout is-error">
              <IconX className="pc-i" aria-hidden="true" />
              <div className="pc-callout-body">
                <strong>This version does not compile</strong>
                {preview.error}
              </div>
            </div>
          )}
          <div className="pc-msg-body rounded-md border border-line bg-inset px-3 py-2" data-testid="preview-message">
            {details.reply ?? selected.message}
          </div>
          <div className="pc-row">
            <button
              type="button"
              className="pc-btn is-primary"
              disabled={isHead}
              onClick={() => void useProjectStore.getState().restore(selected.id).then(leave)}
            >
              <IconRestore className="pc-i" aria-hidden="true" />
              Restore {selected.label}
            </button>
            <button type="button" className="pc-btn" disabled={isHead} onClick={() => void useProjectStore.getState().branchFrom(selected.id).then(leave)}>
              Branch from here
            </button>
          </div>
          <span className="pc-caption">Restoring makes a new version. Nothing is deleted.</span>
        </div>
      </section>
    </main>
  )
}
