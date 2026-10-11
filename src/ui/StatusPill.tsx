import { formatLoadProgress, type LoadProgress } from '../render/loadProgress'
import type { Diagnostic } from '../render/types'
import type { RenderStatus } from '../state/store'
import { IconCheck, IconSpinner, IconWarning, IconX } from './icons'

export type PillTone = 'busy' | 'ok' | 'warn' | 'error'

export interface StatusDescription {
  tone: PillTone
  label: string
  /** Render time, shown in mono after the label. */
  ms: string | null
  /** Trailing text after the time, e.g. " · 2 warnings". */
  suffix: string
  /** First error line, when the failure names one. */
  line: number | null
  /** Full reason, for the tooltip. */
  title: string | null
}

const TIMEOUT = /timed out after (\d+ s)/i

export function describeStatus(
  status: RenderStatus,
  renderMs: number | null,
  error: string | null,
  diagnostics: Diagnostic[],
  loadProgress: LoadProgress | null = null,
): StatusDescription {
  const base = { ms: null, suffix: '', line: null, title: null }
  switch (status) {
    case 'idle':
      return loadProgress
        ? { ...base, tone: 'busy', label: 'Loading OpenSCAD', ms: formatLoadProgress(loadProgress) }
        : { ...base, tone: 'busy', label: 'Loading OpenSCAD…' }
    case 'rendering':
      return { ...base, tone: 'busy', label: 'Rendering…' }
    case 'ok': {
      const warnings = diagnostics.filter((d) => d.severity === 'warning').length
      return {
        ...base,
        tone: warnings > 0 ? 'warn' : 'ok',
        label: 'Rendered',
        ms: `${Math.round(renderMs ?? 0)} ms`,
        suffix: warnings > 0 ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '',
      }
    }
    case 'error': {
      const first = diagnostics.find((d) => d.severity === 'error')
      if (first) return { ...base, tone: 'error', label: `Failed · line ${first.line}`, line: first.line, title: error }
      const timeout = TIMEOUT.exec(error ?? '')
      return { ...base, tone: 'error', label: timeout ? `Timed out after ${timeout[1]}` : 'Failed', title: error }
    }
  }
}

const ICONS = { busy: IconSpinner, ok: IconCheck, warn: IconWarning, error: IconX } as const

interface Props {
  status: RenderStatus
  renderMs: number | null
  error: string | null
  diagnostics: Diagnostic[]
  onGoToLine?(line: number): void
  loadProgress?: LoadProgress | null
}

export function StatusPill({ status, renderMs, error, diagnostics, onGoToLine, loadProgress }: Props) {
  const d = describeStatus(status, renderMs, error, diagnostics, loadProgress ?? null)
  const Icon = ICONS[d.tone]
  const className = `pc-status is-${d.tone}`
  const content = (
    <>
      <Icon className="pc-i" aria-hidden="true" />
      {d.label}
      {d.ms && (
        <>
          {' '}
          <span className="pc-mono">{d.ms}</span>
        </>
      )}
      {d.suffix}
    </>
  )
  if (d.line !== null && onGoToLine) {
    const line = d.line
    return (
      <button
        type="button"
        data-testid="render-status"
        className={`${className} cursor-pointer`}
        title={d.title ?? undefined}
        onClick={() => onGoToLine(line)}
      >
        {content}
      </button>
    )
  }
  return (
    <span data-testid="render-status" role="status" className={className} title={d.title ?? undefined}>
      {content}
    </span>
  )
}
