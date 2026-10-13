import { useState } from 'react'
import { usePhotosDialog } from '../../photos/photosDialogStore'
import type { ParamValue } from '../../render/types'
import { SOURCE_LABEL } from '../../scad/customizer'
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

function SizeField({ row, onCommit }: { row: SizeRow; onCommit(value: ParamValue): void }) {
  const [text, setText] = useState(String(row.value))
  if (typeof row.value !== 'number') return <span className="pc-mono text-[13px]">{String(row.value)}</span>
  const commit = () => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) {
      if (n !== row.value) onCommit(n)
    } else setText(String(row.value))
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

/** Every size of the latest build and where it came from (spec P8). */
export function SizesCardView({ card }: { card: SizesCard }) {
  const accept = useAgentStore((s) => s.acceptSizes)
  const openPhotos = usePhotosDialog((s) => s.setOpen)
  const guessed = card.rows.filter((r) => r.source === 'guess').length
  const given = card.rows.some((r) => r.source !== null)
  const setSize = (name: string, value: ParamValue) => {
    const app = useAppStore.getState()
    app.setParams({ ...app.params, [name]: value })
  }
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
      {open && <span className="pc-caption">{guessed > 0 ? 'Check the guessed sizes first. Photo estimates are within about 1 mm.' : 'Every size came from the description or the photos.'}</span>}
      <div>
        {card.rows.map((row) => (
          <div key={row.name} className="grid items-center gap-2 border-b border-line py-1 text-[13px] last:border-b-0" style={{ gridTemplateColumns: 'minmax(0, 1fr) 96px 128px' }}>
            <span className="pc-mono truncate">{row.name}</span>
            {open ? (
              <SizeField row={row} onCommit={(v) => setSize(row.name, v)} />
            ) : (
              <span className="pc-mono">
                {String(row.value)}
                {row.unit ? ` ${row.unit}` : ''}
              </span>
            )}
            <SourceTag source={row.source} />
          </div>
        ))}
      </div>
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
