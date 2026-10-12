import { useState } from 'react'
import { LIBRARY_INFO, type LibraryName } from '../render/libraries'
import { IconCheck, IconChevronRight } from './icons'

/** BOSL2 covers threads, gears and fillets, which most printable parts need. */
export const RECOMMENDED_LIBRARY: LibraryName = 'BOSL2'

interface Props {
  lib: LibraryName
  on: boolean
  onToggle(): void
}

/** One library with its switch, summary and an expandable list of what it contains. */
export function LibraryCard({ lib, on, onToggle }: Props) {
  const [open, setOpen] = useState(false)
  const info = LIBRARY_INFO[lib]
  return (
    <div className={`flex flex-col rounded-lg border ${on ? 'border-accent' : 'border-line'} bg-panel pb-3`}>
      <label className="flex cursor-pointer items-start gap-3 p-4 pb-1">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{lib}</span>
            <span className="pc-muted">{info.title}</span>
            {lib === RECOMMENDED_LIBRARY && <span className="pc-chip is-accent">Recommended</span>}
          </span>
          <span>{info.summary}</span>
          <span className="pc-caption pc-mono">
            {info.version} · {info.license}
          </span>
        </span>
        <span className="pc-switch mt-0.5">
          <input type="checkbox" aria-label={`Use ${lib} in this project`} checked={on} onChange={onToggle} />
          <span className="pc-track" />
        </span>
      </label>
      <button
        type="button"
        className="pc-btn is-ghost is-sm mx-3 self-start text-accent"
        aria-expanded={open}
        aria-controls={`library-${lib}-contents`}
        onClick={() => setOpen((o) => !o)}
      >
        <IconChevronRight className={`pc-i transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
        What is inside
      </button>
      {open && (
        <div id={`library-${lib}-contents`} className="mx-4 mt-1 flex flex-col gap-3 border-t border-line pt-3">
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {info.contents.map((c) => (
              <li key={c.name} className="flex items-start gap-2">
                <IconCheck className="pc-i mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{c.name}</span> <span className="pc-muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p>
            <span className="pc-muted">Good for:</span> {info.goodFor}
          </p>
          <p>
            <span className="pc-muted">Trade-off:</span> {info.tradeoff}
          </p>
          <code className="pc-mono self-start rounded-sm bg-inset px-2 py-1 text-[12px] text-syn-keyword">{info.usage}</code>
        </div>
      )}
    </div>
  )
}
