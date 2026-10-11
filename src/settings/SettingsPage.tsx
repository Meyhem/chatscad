import { useState } from 'react'
import { useAppStore } from '../state/store'
import { ProfileForm } from './ProfileForm'
import { ProfileList } from './ProfileList'
import { useProvidersStore } from './providersStore'

export function SettingsPage() {
  const setView = useAppStore((s) => s.setView)
  const profiles = useProvidersStore((s) => s.profiles)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0] ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="settings">
      <header className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-line bg-panel pl-4 pr-3">
        <span className="text-[15px] font-bold tracking-tight">PromptCAD</span>
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        <h1 className="text-[14px] font-semibold">Settings</h1>
        <span className="flex-1" />
        <button type="button" className="pc-btn is-sm" onClick={() => setView('workbench')}>
          Back to project
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[240px_360px_minmax(0,1fr)] md:overflow-hidden">
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5 border-b border-line bg-panel px-2 py-3 md:border-b-0">
          <button type="button" className="pc-btn is-ghost justify-start bg-accent-soft text-ink" aria-current="page">
            AI providers
          </button>
          <button type="button" className="pc-btn is-ghost justify-start" disabled title="Arrives with project history">
            Usage and cost
          </button>
        </nav>

        <ProfileList profiles={profiles} selectedId={selected?.id ?? null} onSelect={setSelectedId} />

        {selected ? (
          <ProfileForm key={selected.id} profile={selected} />
        ) : (
          <section aria-label="Profile" className="bg-panel md:border-l md:border-line">
            <p className="pc-muted p-6">Add a provider to start. Presets fill in the address for you.</p>
          </section>
        )}
      </main>
    </div>
  )
}
