import type { ThemeSetting } from '../../db/db'
import { useSettingsStore } from '../settingsStore'

const OPTIONS: Array<{ value: ThemeSetting; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

export function AppearanceSection() {
  const theme = useSettingsStore((s) => s.settings.theme)
  return (
    <section aria-labelledby="appearance-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="appearance-title" className="text-[20px] leading-[26px] font-semibold">
        Appearance
      </h2>
      <div role="radiogroup" aria-label="Theme" className="pc-tabs self-start">
        {OPTIONS.map((o) => (
          <label key={o.value} className="pc-tab has-[:checked]:bg-accent-soft has-[:checked]:text-ink">
            <input
              type="radio"
              name="theme"
              className="sr-only"
              checked={theme === o.value}
              onChange={() => void useSettingsStore.getState().update({ theme: o.value })}
            />
            {o.label}
          </label>
        ))}
      </div>
      <span className="pc-hint">System follows your device. Dark is the primary theme; light is a full peer.</span>
    </section>
  )
}
