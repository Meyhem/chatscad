import { Fragment } from 'react'
import { unifiedLines, type DiffCell, type DiffRow } from './diff'

function Cell({ cell, divider = false }: { cell: DiffCell | null; divider?: boolean }) {
  const tone = cell?.kind === 'add' ? 'bg-ok-soft' : cell?.kind === 'del' ? 'bg-error-soft' : ''
  const mark = cell?.kind === 'add' ? '+' : cell?.kind === 'del' ? '−' : ''
  return (
    <div className={`grid grid-cols-[44px_14px_minmax(0,1fr)] whitespace-pre ${tone} ${divider ? 'border-r border-line' : ''}`} data-kind={cell?.kind ?? 'empty'}>
      <span className="pr-2 text-right text-syn-comment">{cell?.line ?? ''}</span>
      <span className="grid place-items-center">{mark}</span>
      <span className="overflow-hidden text-ink">{cell?.text ?? ''}</span>
    </div>
  )
}

/** Phones: one column, old and new line numbers, long lines wrap instead of being cut off. */
function UnifiedDiff({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-inset py-2 font-mono text-[13px] leading-5" data-testid="diff" data-layout="unified">
      {unifiedLines(rows).map((l, i) =>
        l.kind === 'skip' ? (
          <div key={i} className="pc-caption py-0.5 pl-[80px] font-sans">
            ⋯ {l.count} unchanged line{l.count === 1 ? '' : 's'}
          </div>
        ) : (
          <div
            key={i}
            className={`grid grid-cols-[32px_32px_14px_minmax(0,1fr)] ${l.kind === 'add' ? 'bg-ok-soft' : l.kind === 'del' ? 'bg-error-soft' : ''}`}
            data-kind={l.kind}
          >
            <span className="pr-1 text-right text-syn-comment">{l.oldLine ?? ''}</span>
            <span className="pr-1 text-right text-syn-comment">{l.newLine ?? ''}</span>
            <span className="grid place-items-start justify-center">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
            <span className="break-all whitespace-pre-wrap text-ink">{l.text}</span>
          </div>
        ),
      )}
    </div>
  )
}

export function DiffView({ rows, layout = 'split' }: { rows: DiffRow[]; layout?: 'split' | 'unified' }) {
  if (layout === 'unified') return <UnifiedDiff rows={rows} />
  return (
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 overflow-auto bg-inset py-2 font-mono text-[13px] leading-5" data-testid="diff" data-layout="split">
      {rows.map((r, i) =>
        r.kind === 'skip' ? (
          <div key={i} className="pc-caption col-span-2 py-0.5 pl-[58px] font-sans">
            ⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}
          </div>
        ) : (
          <Fragment key={i}>
            <Cell cell={r.left} divider />
            <Cell cell={r.right} />
          </Fragment>
        ),
      )}
    </div>
  )
}
