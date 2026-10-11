import { usePrefs } from './prefsStore'

export function LowQualityPreviewSwitch() {
  const on = usePrefs((s) => s.lowQualityPreview)
  const update = usePrefs((s) => s.update)
  return (
    <div className="pc-field">
      <label className="pc-switch">
        <input type="checkbox" checked={on} onChange={(e) => void update({ lowQualityPreview: e.target.checked })} />
        <span className="pc-track" />
        Quick preview before each render
      </label>
      <span className="pc-hint">
        Renders once with $fn = 12 so a rough shape shows sooner on phones, then renders in full. Export waits for the full render.
      </span>
    </div>
  )
}
