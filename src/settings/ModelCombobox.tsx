import { useState, type KeyboardEvent } from 'react'
import type { ModelInfo, ModelPrice } from '../ai/types'
import { IconPlus, IconSearch } from '../ui/icons'

const MAX_SHOWN = 50

const usd = (n: number) => (n === 0 || n >= 0.01 ? `$${n.toFixed(2)}` : `$${Number(n.toPrecision(4))}`)

/** "$3.00 / $15.00": input and output price per million tokens. */
export function formatPrice(p: ModelPrice): string {
  return `${usd(p.inputPerMTok)} / ${usd(p.outputPerMTok)}`
}

interface Props {
  id: string
  value: string
  models: ModelInfo[]
  /** The profile's own prices; they win over the listed ones. */
  priceTable: Record<string, ModelPrice>
  /** Every keystroke and every pick; free text is always allowed. */
  onChange(id: string): void
  /** A model chosen from the list. */
  onPick(model: ModelInfo): void
}

/** A searchable model field: the provider's list with prices, plus whatever name the person types. */
export function ModelCombobox({ id, value, models, priceTable, onChange, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const q = query.trim().toLowerCase()
  const matches = q === '' ? models : models.filter((m) => m.id.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q))
  const shown = matches.slice(0, MAX_SHOWN)
  const asTyped = query.trim() !== '' && !models.some((m) => m.id === query.trim())
  const count = shown.length + (asTyped ? 1 : 0)
  const listId = `${id}-models`
  const optionId = (i: number) => `${id}-model-${i}`

  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  const pick = (m: ModelInfo) => {
    onChange(m.id)
    onPick(m)
    close()
  }
  const choose = (i: number) => {
    if (i < shown.length) pick(shown[i])
    else if (asTyped) {
      onChange(query.trim())
      close()
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      if (count === 0) return
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % count : (a - 1 + count) % count))
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close()
    }
  }

  return (
    <div className="relative">
      <div className="pc-input is-mono">
        <IconSearch className="pc-i" aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onFocus={() => {
            setQuery('')
            setOpen(true)
          }}
          onBlur={close}
          onChange={(e) => {
            onChange(e.target.value)
            setQuery(e.target.value)
            setActive(-1)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && count > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 flex max-h-80 flex-col overflow-auto rounded-md border border-line bg-panel-raised p-1 shadow-(--shadow-pop)">
          <div id={listId} role="listbox" aria-label="Models" className="flex flex-col">
            {shown.map((m, i) => {
              const price = priceTable[m.id] ?? m.price
              return (
                <div
                  key={m.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 rounded-sm px-2.5 py-2 hover:bg-panel aria-selected:bg-accent-soft"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(m)
                  }}
                >
                  <span className="truncate font-semibold">{m.name ?? m.id}</span>
                  {price ? (
                    <span className="pc-mono text-right text-[12px]">{formatPrice(price)}</span>
                  ) : (
                    <span className="pc-caption text-right">No price listed</span>
                  )}
                  <span className="pc-caption pc-mono truncate">{m.id}</span>
                  <span className="flex justify-end gap-1">
                    {m.capabilities?.vision && <span className="pc-chip">vision</span>}
                    {m.capabilities?.audio && <span className="pc-chip">audio</span>}
                  </span>
                </div>
              )
            })}
            {asTyped && (
              <div
                id={optionId(shown.length)}
                role="option"
                aria-selected={active === shown.length}
                className={`flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 hover:bg-panel aria-selected:bg-accent-soft ${shown.length > 0 ? 'mt-1 border-t border-line' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(shown.length)
                }}
              >
                <IconPlus className="pc-i" aria-hidden="true" />
                <span>Use “{query.trim()}” as typed</span>
              </div>
            )}
          </div>
          {models.length > 0 && (
            <span className="pc-caption px-2.5 pt-1.5 pb-1">
              {shown.length} of {models.length} models · prices per 1M input / output tokens
            </span>
          )}
        </div>
      )}
    </div>
  )
}
