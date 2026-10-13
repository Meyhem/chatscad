import type { CSSProperties } from 'react'
import type { LegendEntry } from '../review'

export function Swatch({ token }: { token: string }) {
  return <span className="pc-swatch" aria-hidden="true" style={{ '--swatch': `var(--${token})` } as CSSProperties} />
}

/** Part colour legend: swatch, module name, lines. Model output (labels) renders as text only. */
export function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <div className="pc-legend" role="list" aria-label="Part colours">
      {entries.map((e) => (
        <span key={e.tag} role="listitem">
          <Swatch token={e.token} />
          <span className={e.tag === 0 ? '' : 'pc-mono'}>{e.label}</span>
          {e.lines && <span className="pc-caption">{e.lines}</span>}
        </span>
      ))}
    </div>
  )
}
