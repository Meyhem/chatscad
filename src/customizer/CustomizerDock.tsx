import { useEffect, useMemo, useState } from 'react'
import { ADD_PARAMETERS_PROMPT, ANNOTATE_PROMPT, usePromptRequest } from '../chat/promptRequest'
import type { Preset } from '../db/db'
import { deletePreset, listPresets, putPreset } from '../db/presets'
import { useProjectStore } from '../history/projectStore'
import { paramsEqual, type Params } from '../render/params'
import { bakeParams, effectiveValues, paramOverrides, parseCustomizer } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { IconTrash } from '../ui/icons'
import { ParamRow } from './ParamRow'

const DEFAULT = 'default'
const CUSTOM = 'custom'
const SAVE = 'save'

const setParams = (params: Params) => useAppStore.getState().setParams(params)
const ask = (text: string) => usePromptRequest.getState().ask(text)

/** `height`: a fixed height in px from the desktop divider; otherwise as tall as its content, up to 45 % of the column. */
export function CustomizerDock({ height = null }: { height?: number | null } = {}) {
  const code = useAppStore((s) => s.code)
  const params = useAppStore((s) => s.params)
  const projectId = useProjectStore((s) => s.project?.id ?? null)
  const parsed = useMemo(() => parseCustomizer(code), [code])
  const values = useMemo(() => effectiveValues(code, params), [code, params])
  const overrides = useMemo(() => paramOverrides(code, params), [code, params])
  const groups = useMemo(() => [...new Set(parsed.map((p) => p.group))], [parsed])
  const [tab, setTab] = useState('')
  const [presets, setPresets] = useState<Preset[]>([])
  const [saving, setSaving] = useState(false)
  const [presetName, setPresetName] = useState('')

  useEffect(() => {
    let live = true
    if (projectId) void listPresets(projectId).then((list) => live && setPresets([...list]))
    else setPresets([])
    return () => {
      live = false
    }
  }, [projectId])

  const active = groups.includes(tab) ? tab : (groups[0] ?? '')
  const changed = Object.keys(overrides).length
  const selected =
    changed === 0 ? DEFAULT : (presets.find((p) => paramsEqual(paramOverrides(code, p.params), overrides))?.id ?? CUSTOM)

  const reload = async () => {
    if (projectId) setPresets([...(await listPresets(projectId))])
  }

  const onPreset = (id: string) => {
    if (id === SAVE) setSaving(true)
    else if (id === DEFAULT) setParams({})
    else {
      const preset = presets.find((p) => p.id === id)
      if (preset) setParams(preset.params)
    }
  }

  const savePreset = async () => {
    const name = presetName.trim()
    if (!name || !projectId) return
    await putPreset({ id: crypto.randomUUID(), projectId, name, params: overrides })
    await reload()
    setSaving(false)
    setPresetName('')
  }

  const bake = () => {
    const app = useAppStore.getState()
    app.setCode(bakeParams(app.code, paramOverrides(app.code, app.params)), 'slider')
    app.setParams({})
  }

  if (parsed.length === 0) {
    return (
      <section aria-label="Parameters" className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-4 py-3">
        <span className="pc-caption">This model has no parameters yet.</span>
        <span className="flex-1" />
        <button type="button" className="pc-btn is-sm is-ghost" onClick={() => ask(ADD_PARAMETERS_PROMPT)}>
          Ask AI to add parameters
        </button>
      </section>
    )
  }

  const unannotated = parsed.some((p) => p.control.kind === 'number' && !p.annotated)

  return (
    <section
      aria-label="Parameters"
      className={`flex shrink-0 flex-col gap-2 overflow-auto bg-panel px-4 pt-3 pb-4 ${height === null ? 'max-h-[45%] border-t border-line' : ''}`}
      style={height === null ? undefined : { height }}
    >
      <div className="pc-row">
        <div className="pc-tabs" role="tablist" aria-label="Parameter groups">
          {groups.map((g) => (
            <button key={g || 'parameters'} type="button" role="tab" className="pc-tab" aria-selected={g === active} onClick={() => setTab(g)}>
              {g || 'Parameters'}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <select className="pc-select h-(--control-sm) text-[13px]" aria-label="Preset" value={selected} onChange={(e) => onPreset(e.target.value)}>
          <option value={DEFAULT}>Preset: default</option>
          {selected === CUSTOM && (
            <option value={CUSTOM} disabled>
              Preset: custom
            </option>
          )}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              Preset: {p.name}
            </option>
          ))}
          <option value={SAVE} disabled={changed === 0 || !projectId}>
            Save as preset…
          </option>
        </select>
        {presets.some((p) => p.id === selected) && (
          <button
            type="button"
            className="pc-btn is-sm is-ghost is-icon"
            aria-label="Delete preset"
            title="Delete preset"
            onClick={() => void deletePreset(selected).then(reload)}
          >
            <IconTrash className="pc-i" aria-hidden="true" />
          </button>
        )}
        <button type="button" className="pc-btn is-sm is-ghost" disabled={changed === 0} onClick={() => setParams({})}>
          Reset
        </button>
        <button type="button" className="pc-btn is-sm" disabled={changed === 0} onClick={bake}>
          Bake into code
        </button>
      </div>

      {saving && (
        <div className="pc-row">
          <div className="pc-input w-56">
            <input
              aria-label="Preset name"
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void savePreset()}
            />
          </div>
          <button type="button" className="pc-btn is-sm" disabled={presetName.trim() === ''} onClick={() => void savePreset()}>
            Save preset
          </button>
          <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setSaving(false)}>
            Cancel
          </button>
        </div>
      )}

      {parsed
        .filter((p) => p.group === active)
        .map((p) => (
          <ParamRow
            key={p.name}
            param={p}
            value={values[p.name]!}
            onChange={(v) => setParams({ ...useAppStore.getState().params, [p.name]: v })}
          />
        ))}

      {unannotated && (
        <div className="pc-row">
          <span className="pc-caption">Some numbers have no range yet, so they get a plain input.</span>
          <button type="button" className="pc-btn is-sm is-ghost" onClick={() => ask(ANNOTATE_PROMPT)}>
            Ask AI to annotate
          </button>
        </div>
      )}
    </section>
  )
}
