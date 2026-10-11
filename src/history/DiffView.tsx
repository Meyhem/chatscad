import { Fragment } from 'react'
import type { DiffCell, DiffRow } from './diff'

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

export function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 overflow-auto bg-inset py-2 font-mono text-[13px] leading-5" data-testid="diff">
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
