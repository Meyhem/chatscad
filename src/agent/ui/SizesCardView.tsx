import { useState } from 'react'
import { effectiveValues, SOURCE_LABEL } from '../../scad/customizer'
import { usePhotosDialog } from '../../photos/photosDialogStore'
import type { ParamValue } from '../../render/types'
import { useAppStore } from '../../state/store'
import { IconCamera, IconCheck, IconSize } from '../../ui/icons'
import { useAgentStore, type SizesCard } from '../agentStore'
import type { SizeRow } from '../sizes'

const sourceClass = { guess: 'bg-warn-soft text-warn', photo: 'bg-accent-soft text-ink', description: 'bg-ok-soft text-ok' } as const
const tag = 'inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-medium'

function SourceTag({ source }: { source: SizeRow['source'] }) {
  if (!source) return <span className="pc-caption">Source not given</span>
  return <span className={`${tag} ${sourceClass[source]}`}>{SOURCE_LABEL[source]}</span>
}

function SizeField({ row, live, onCommit }: { row: SizeRow; live: ParamValue; onCommit(value: ParamValue): void }) {
  const [text, setText] = useState(String(live))
  const [seen, setSeen] = useState(live)
  // An outside change (Customizer slider, Reset) replaces what is typed.
  if (seen !== live) {
    setSeen(live)
    setText(String(live))
  }
  if (typeof live !== 'number') return <span className="pc-mono text-[13px]">{String(live)}</span>
  const commit = () => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) {
      if (n !== live) onCommit(n)
    } else setText(String(live))
  }
  return (
    <div className="pc-input is-mono" style={{ height: 26, padding: '0 6px' }}>
      <input
        type="number"
        aria-label={`${row.name}${row.unit ? ` in ${row.unit}` : ''}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {row.unit && <span className="pc-unit">{row.unit}</span>}
    </div>
  )
}

const rowClass = 'grid items-center gap-2 border-b border-line py-1 text-[13px] last:border-b-0'
const rowColumns = { gridTemplateColumns: 'minmax(0, 1fr) 96px 128px' }

const setSize = (name: string, value: ParamValue) => {
  const app = useAppStore.getState()
  app.setParams({ ...app.params, [name]: value })
}

/** The open card's rows follow the code and the parameters, so only it reads them. */
function LiveRows({ rows }: { rows: readonly SizeRow[] }) {
  const code = useAppStore((s) => s.code)
  const params = useAppStore((s) => s.params)
  const values = effectiveValues(code, params)
  return (
    <div>
      {rows.map((row) => (
        <div key={row.name} className={rowClass} style={rowColumns}>
          <span className="pc-mono truncate">{row.name}</span>
          <SizeField row={row} live={values[row.name] ?? row.value} onCommit={(v) => setSize(row.name, v)} />
          <SourceTag source={row.source} />
        </div>
      ))}
    </div>
  )
}

/** A checked or out-of-date card shows the values it kept. */
function ClosedRows({ rows }: { rows: readonly SizeRow[] }) {
  return (
    <div>
      {rows.map((row) => (
        <div key={row.name} className={rowClass} style={rowColumns}>
          <span className="pc-mono truncate">{row.name}</span>
          <span className="pc-mono">
            {String(row.value)}
            {row.unit ? ` ${row.unit}` : ''}
          </span>
          <SourceTag source={row.source} />
        </div>
      ))}
    </div>
  )
}

/** Every size of the latest build and where it came from (spec P8). */
export function SizesCardView({ card }: { card: SizesCard }) {
  const accept = useAgentStore((s) => s.acceptSizes)
  const openPhotos = usePhotosDialog((s) => s.setOpen)
  const guessed = card.rows.filter((r) => r.source === 'guess').length
  const given = card.rows.some((r) => r.source !== null)
  const open = card.status === 'ready'
  return (
    <div className="pc-agent-card" data-testid="sizes-card">
      <div className="flex items-center gap-2">
        <IconSize className="pc-i text-ink-muted" aria-hidden="true" />
        <span className="font-semibold">
          {card.versionLabel ? `Sizes in ${card.versionLabel}` : 'Sizes'} · {card.rows.length}
        </span>
        <span className="flex-1" />
        {given ? <span className={`${tag} ${guessed > 0 ? sourceClass.guess : sourceClass.description}`}>{guessed} guessed</span> : <span className="pc-caption">Source not given</span>}
        {card.status === 'accepted' && <span className="pc-status is-ok">Checked</span>}
        {card.status === 'superseded' && <span className="pc-status">Out of date</span>}
      </div>
      {open && <span className="pc-caption">{guessed > 0 ? 'Check the guessed sizes first. The model estimated them from the photos.' : 'Every size came from the description or the photos.'}</span>}
      {open ? <LiveRows rows={card.rows} /> : <ClosedRows rows={card.rows} />}
      {open && (
        <>
          <div className="pc-row">
            <button type="button" className="pc-btn is-sm is-primary" onClick={() => accept(card.id)}>
              <IconCheck className="pc-i" aria-hidden="true" />
              Sizes look right
            </button>
            <button type="button" className="pc-btn is-sm" onClick={() => openPhotos(true)}>
              <IconCamera className="pc-i" aria-hidden="true" />
              Add a photo
            </button>
          </div>
          <span className="pc-caption">Changing a size here re-renders at once. Later builds keep it.</span>
        </>
      )}
    </div>
  )
}
