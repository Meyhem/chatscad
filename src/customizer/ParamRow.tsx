import { useEffect, useState } from 'react'
import { formatValue } from '../history/messages'
import { paramValueEqual } from '../render/params'
import type { ParamValue } from '../render/types'
import type { CustomizerParam } from '../scad/customizer'
import { unitFor } from './units'

const AXES = ['x', 'y', 'z', 'w']

function NumberField({
  label,
  value,
  unit,
  onCommit,
  className = '',
}: {
  label: string
  value: number
  unit: string
  onCommit(n: number): void
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const valid = draft.trim() !== '' && Number.isFinite(Number(draft))
  return (
    <div className={`pc-input is-mono${valid ? '' : ' is-invalid'} ${className}`.trim()}>
      <input
        aria-label={label}
        aria-invalid={!valid}
        inputMode="decimal"
        value={draft}
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          if (text.trim() !== '' && Number.isFinite(Number(text))) onCommit(Number(text))
        }}
        onBlur={() => setDraft(String(value))}
      />
      {unit && <span className="pc-unit">{unit}</span>}
    </div>
  )
}

interface Props {
  param: CustomizerParam
  value: ParamValue
  onChange(value: ParamValue): void
}

export function ParamRow({ param, value, onChange }: Props) {
  const c = param.control
  const changed = !paramValueEqual(value, param.defaultValue)
  const unit = c.kind === 'slider' || c.kind === 'number' ? unitFor(param) : ''
  const hint = c.kind === 'slider' ? `[${c.min} : ${c.step} : ${c.max}]` : c.kind === 'number' && c.step !== undefined ? `step ${c.step}` : null
  const num = typeof value === 'number' ? value : Number(param.defaultValue)

  let control: React.ReactNode
  switch (c.kind) {
    case 'slider':
      control = (
        <>
          <input
            className="pc-range"
            type="range"
            aria-label={param.name}
            min={c.min}
            max={c.max}
            step={c.step}
            value={num}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <NumberField label={`${param.name} value`} value={num} unit={unit} onCommit={onChange} />
        </>
      )
      break
    case 'number':
      control = <NumberField className="col-span-2" label={param.name} value={num} unit={unit} onCommit={onChange} />
      break
    case 'dropdown': {
      const index = c.options.findIndex((o) => o.value === value)
      control = (
        <select
          className="pc-select col-span-2"
          aria-label={param.name}
          value={index === -1 ? 'other' : String(index)}
          onChange={(e) => {
            const option = c.options[Number(e.target.value)]
            if (option) onChange(option.value)
          }}
        >
          {index === -1 && (
            <option value="other" disabled>
              {formatValue(value)}
            </option>
          )}
          {c.options.map((o, i) => (
            <option key={i} value={String(i)}>
              {o.label}
            </option>
          ))}
        </select>
      )
      break
    }
    case 'toggle':
      control = (
        <label className="pc-switch col-span-2">
          <input type="checkbox" aria-label={param.name} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="pc-track" />
        </label>
      )
      break
    case 'text':
      control = (
        <div className="pc-input col-span-2">
          <input aria-label={param.name} value={String(value)} onChange={(e) => onChange(e.target.value)} />
        </div>
      )
      break
    case 'vector': {
      const items = Array.isArray(value) ? value : (param.defaultValue as number[])
      control = (
        <div className="col-span-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${c.length}, minmax(0, 1fr))` }}>
          {items.map((n, i) => (
            <NumberField
              key={i}
              label={`${param.name} ${AXES[i] ?? i + 1}`}
              value={n}
              unit=""
              onCommit={(next) => onChange(items.map((old, k) => (k === i ? next : old)))}
            />
          ))}
        </div>
      )
      break
    }
  }

  return (
    <div className={`pc-param${changed ? ' is-changed' : ''}`} title={param.description || undefined} data-testid={`param-${param.name}`}>
      <div className="pc-param-name">
        {param.name}
        {hint && <small>{hint}</small>}
      </div>
      {control}
    </div>
  )
}
