import { useEffect, useRef } from 'react'
import { parseDiagnosticLine } from '../render/diagnostics'
import type { LogLine } from '../render/types'
import type { RenderStatus } from '../state/store'

export type LogTone = '' | 'is-muted' | 'is-ok' | 'is-warn' | 'is-error'

export function logTone({ stream, text }: LogLine): LogTone {
  if (/^ERROR\b/.test(text) || /^Execution aborted/.test(text)) return 'is-error'
  if (/^(WARNING|DEPRECATED)\b/.test(text)) return 'is-warn'
  if (/^Total rendering time/.test(text)) return 'is-ok'
  if (/^ECHO\b/.test(text)) return ''
  return stream === 'stderr' ? 'is-muted' : ''
}

export function summaryLine(
  status: RenderStatus,
  error: string | null,
  renderMs: number | null,
  logs: LogLine[],
): { text: string; tone: LogTone } | null {
  const ms = `${Math.round(renderMs ?? 0)} ms`
  switch (status) {
    case 'idle':
      return { text: 'Loading OpenSCAD…', tone: 'is-muted' }
    case 'rendering':
      return { text: 'Compiling main.scad…', tone: 'is-muted' }
    case 'ok':
      return { text: `Rendered in ${ms}`, tone: 'is-ok' }
    case 'error': {
      const explained = logs.some((l) => /^ERROR\b/.test(l.text))
      return { text: `${error ?? 'Render failed'} · ${ms}`, tone: explained ? 'is-muted' : 'is-error' }
    }
  }
}

interface Props {
  status: RenderStatus
  logs: LogLine[]
  error: string | null
  renderMs: number | null
  onGoToLine?(line: number): void
}

export function ConsolePanel({ status, logs, error, renderMs, onGoToLine }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs, error, status])

  const summary = summaryLine(status, error, renderMs, logs)

  return (
    <section className="pc-console flex h-full flex-col rounded-none border-0" aria-label="Console">
      <div className="pc-console-head shrink-0">
        <span className="pc-label">Console</span>
        <span className="pc-caption ml-auto">OpenSCAD · manifold</span>
      </div>
      <div ref={ref} data-testid="console" className="min-h-0 flex-1 overflow-auto py-1">
        {logs.map((line, i) => {
          const className = `pc-log ${logTone(line)}`.trim()
          const located = parseDiagnosticLine(line.text)
          return located && onGoToLine ? (
            <button
              key={i}
              type="button"
              className={className}
              title={`Go to line ${located.line}`}
              onClick={() => onGoToLine(located.line)}
            >
              {line.text}
            </button>
          ) : (
            <div key={i} className={className}>
              {line.text}
            </div>
          )
        })}
        {summary && <div className={`pc-log ${summary.tone}`.trim()}>{summary.text}</div>}
      </div>
    </section>
  )
}
