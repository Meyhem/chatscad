import type { Diagnostic } from '../render/types'
import type { RenderStatus } from '../state/store'

export interface ProblemItem {
  line: number | null
  severity: 'error' | 'warning'
  text: string
}

export function problemItems(status: RenderStatus, error: string | null, diagnostics: Diagnostic[]): ProblemItem[] {
  const items: ProblemItem[] = diagnostics.map((d) => ({ line: d.line, severity: d.severity, text: d.message }))
  if (status === 'error' && error && !diagnostics.some((d) => d.severity === 'error')) items.unshift({ line: null, severity: 'error', text: error })
  return items
}

export function ProblemsPanel({ items, onGoToLine }: { items: ProblemItem[]; onGoToLine(line: number): void }) {
  if (items.length === 0) {
    return (
      <p className="pc-caption p-3" data-testid="problems">
        No problems in the last render.
      </p>
    )
  }
  return (
    <div className="pc-console h-full overflow-auto rounded-none border-0 py-1" data-testid="problems">
      {items.map((p, i) => {
        const className = `pc-log ${p.severity === 'error' ? 'is-error' : 'is-warn'}`
        if (p.line === null) {
          return (
            <div key={i} className={className}>
              {p.text}
            </div>
          )
        }
        const line = p.line
        return (
          <button key={i} type="button" className={className} onClick={() => onGoToLine(line)}>
            Line {line} · {p.text}
          </button>
        )
      })}
    </div>
  )
}
