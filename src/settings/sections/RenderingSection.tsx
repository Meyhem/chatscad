import { Fragment, useEffect, useState } from 'react'
import { LowQualityPreviewSwitch } from '../LowQualityPreviewSwitch'
import type { Settings } from '../../db/db'
import { useSettingsStore } from '../settingsStore'
import { VisualCheckSetting } from '../VisualCheckSetting'

interface FieldSpec {
  id: string
  label: string
  unit: string
  min: number
  max: number
  read(s: Settings): number
  write(n: number): Partial<Omit<Settings, 'id'>>
  hint: string
}

const FIELDS: FieldSpec[] = [
  { id: 'debounce', label: 'Debounce', unit: 'ms', min: 100, max: 5_000, read: (s) => s.debounceMs, write: (n) => ({ debounceMs: n }), hint: 'How long to wait after the last change before rendering.' },
  { id: 'timeout', label: 'Timeout', unit: 's', min: 5, max: 600, read: (s) => s.timeoutMs / 1000, write: (n) => ({ timeoutMs: n * 1000 }), hint: 'A render that takes longer is stopped and the worker restarted.' },
  { id: 'autofix', label: 'Auto-fix attempts', unit: '', min: 0, max: 5, read: (s) => s.autoFixAttempts, write: (n) => ({ autoFixAttempts: n }), hint: 'How often a failed AI result is sent back with the errors.' },
]

function Field({ spec, settings }: { spec: FieldSpec; settings: Settings }) {
  const value = spec.read(settings)
  const [draft, setDraft] = useState(String(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    const ok = draft.trim() !== '' && Number.isInteger(n) && n >= spec.min && n <= spec.max
    setInvalid(!ok)
    if (ok && n !== value) void useSettingsStore.getState().update(spec.write(n))
  }
  return (
    <div className="pc-field">
      <label htmlFor={spec.id}>{spec.label}</label>
      <div className={`pc-input is-mono w-40${invalid ? ' is-invalid' : ''}`}>
        <input id={spec.id} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
        {spec.unit && <span className="pc-unit">{spec.unit}</span>}
      </div>
      <span className={`pc-hint${invalid ? ' is-error' : ''}`}>
        {invalid ? `Enter a whole number from ${spec.min.toLocaleString('en-US')} to ${spec.max.toLocaleString('en-US')}` : spec.hint}
      </span>
    </div>
  )
}

export function RenderingSection() {
  const settings = useSettingsStore((s) => s.settings)
  return (
    <section aria-labelledby="rendering-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="rendering-title" className="text-[20px] leading-[26px] font-semibold">
        Rendering
      </h2>
      {FIELDS.map((f) => (
        <Fragment key={f.id}>
          <Field spec={f} settings={settings} />
          {f.id === 'timeout' && <LowQualityPreviewSwitch />}
          {f.id === 'autofix' && <VisualCheckSetting />}
        </Fragment>
      ))}
    </section>
  )
}
