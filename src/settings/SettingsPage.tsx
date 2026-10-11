import { useState } from 'react'
import { viewPanelId } from '../workbench/ViewTabs'
import { ProfileForm } from './ProfileForm'
import { ProfileList } from './ProfileList'
import { useProvidersStore } from './providersStore'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections'

export function SettingsPage() {
  const profiles = useProvidersStore((s) => s.profiles)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [section, setSection] = useState<SettingsSectionId>('providers')
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0] ?? null

  return (
    <div
      role="tabpanel"
      id={viewPanelId('settings')}
      aria-labelledby="view-tab-settings"
      className="flex min-h-0 flex-1 flex-col"
      data-testid="settings"
    >
      <h1 className="sr-only">Settings</h1>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[240px_360px_minmax(0,1fr)] md:overflow-hidden">
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5 border-b border-line bg-panel px-2 py-3 md:border-b-0">
          {SETTINGS_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`pc-btn is-ghost justify-start${s.id === section ? ' bg-accent-soft text-ink' : ''}`}
              aria-current={s.id === section ? 'page' : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {section === 'providers' ? (
          <>
            <ProfileList profiles={profiles} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
            {selected ? (
              <ProfileForm key={selected.id} profile={selected} />
            ) : (
              <section aria-label="Profile" className="bg-panel md:border-l md:border-line">
                <p className="pc-muted p-6">Add a provider to start. Presets fill in the address for you.</p>
              </section>
            )}
          </>
        ) : (
          <div className="min-h-0 overflow-y-auto bg-panel md:col-span-2 md:border-l md:border-line">
            {(() => {
              const { Component } = SETTINGS_SECTIONS.find((s) => s.id === section)!
              return Component ? <Component /> : null
            })()}
          </div>
        )}
      </main>
    </div>
  )
}
