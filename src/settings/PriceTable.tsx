import { useState } from 'react'
import type { ModelPrice } from '../ai/types'
import type { ProviderProfile } from '../db/db'

const isPrice = (s: string) => s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0)

function PriceRow({
  model,
  price,
  listed,
  onCommit,
}: {
  model: string
  price?: ModelPrice
  listed?: ModelPrice
  onCommit(price: ModelPrice | null): void
}) {
  const [input, setInput] = useState(price ? String(price.inputPerMTok) : '')
  const [output, setOutput] = useState(price ? String(price.outputPerMTok) : '')
  const commit = () => {
    if (!isPrice(input) || !isPrice(output)) return
    if (input.trim() === '' && output.trim() === '') onCommit(null)
    else onCommit({ inputPerMTok: Number(input || 0), outputPerMTok: Number(output || 0) })
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px_120px] items-center gap-2">
      <span className="truncate font-mono text-[13px]">{model}</span>
      <div className={`pc-input is-mono ${isPrice(input) ? '' : 'is-invalid'}`}>
        <input
          aria-label={`${model} input price`}
          inputMode="decimal"
          placeholder={listed ? String(listed.inputPerMTok) : 'Input'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={commit}
        />
        <span className="pc-unit">in</span>
      </div>
      <div className={`pc-input is-mono ${isPrice(output) ? '' : 'is-invalid'}`}>
        <input
          aria-label={`${model} output price`}
          inputMode="decimal"
          placeholder={listed ? String(listed.outputPerMTok) : 'Output'}
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          onBlur={commit}
        />
        <span className="pc-unit">out</span>
      </div>
    </div>
  )
}

export function PriceTable({ profile, onChange }: { profile: ProviderProfile; onChange(table: Record<string, ModelPrice>): void }) {
  const [extra, setExtra] = useState('')
  const ids = [...new Set([profile.defaultModel.trim(), ...Object.keys(profile.priceTable)].filter((id) => id !== ''))]
  const commit = (model: string, price: ModelPrice | null) => {
    const next = { ...profile.priceTable }
    if (price) next[model] = price
    else delete next[model]
    onChange(next)
  }
  const add = () => {
    const id = extra.trim()
    if (id === '') return
    commit(id, profile.priceTable[id] ?? { inputPerMTok: 0, outputPerMTok: 0 })
    setExtra('')
  }
  return (
    <div className="pc-stack" data-testid="price-table">
      <span className="pc-label">Price table</span>
      <span className="pc-caption">US dollars per million tokens, used when the provider doesn't report a cost.</span>
      {ids.map((id) => (
        <PriceRow
          key={id}
          model={id}
          price={profile.priceTable[id]}
          listed={profile.cachedModels.find((m) => m.id === id)?.price}
          onCommit={(price) => commit(id, price)}
        />
      ))}
      <div className="pc-row">
        <div className="pc-input is-mono flex-1">
          <input aria-label="Model to price" placeholder="Model name" value={extra} spellCheck={false} onChange={(e) => setExtra(e.target.value)} />
        </div>
        <button type="button" className="pc-btn is-sm" disabled={extra.trim() === ''} onClick={add}>
          Add model
        </button>
      </div>
    </div>
  )
}
