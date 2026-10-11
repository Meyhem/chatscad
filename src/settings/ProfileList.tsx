import { useEffect, useState } from 'react'
import { hostOf, isLocalBaseUrl } from '../ai/url'
import type { ProviderProfile } from '../db/db'
import { monthTotals, type UsageTotal } from '../db/usage'
import { formatCost, formatTokens } from '../ui/format'
import { IconCheck, IconPlus, IconX } from '../ui/icons'
import { PROVIDER_PRESETS } from './presets'
import { useProvidersStore, type ConnectionStatus } from './providersStore'

const BADGES: Record<ConnectionStatus, { tone: 'is-ok' | 'is-error'; label: string }> = {
  ok: { tone: 'is-ok', label: 'OK' },
  blocked: { tone: 'is-error', label: 'Blocked' },
  failed: { tone: 'is-error', label: 'Failed' },
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const badge = BADGES[status]
  const Icon = status === 'ok' ? IconCheck : IconX
  return (
    <span className={`pc-status ${badge.tone}`}>
      <Icon className="pc-i" aria-hidden="true" />
      {badge.label}
    </span>
  )
}

function usageText(total: UsageTotal | undefined): string {
  if (!total) return `${formatCost(0)} · ${formatTokens(0)}`
  const cost = total.cost === 0 && total.unpriced > 0 ? null : total.cost
  return `${formatCost(cost)} · ${formatTokens(total.tokens)}`
}

interface Props {
  profiles: ProviderProfile[]
  selectedId: string | null
  onSelect(id: string): void
}

export function ProfileList({ profiles, selectedId, onSelect }: Props) {
  const addProfile = useProvidersStore((s) => s.addProfile)
  const status = useProvidersStore((s) => s.status)
  const [adding, setAdding] = useState(false)
  const [totals, setTotals] = useState<Map<string, UsageTotal>>(() => new Map())

  useEffect(() => {
    let live = true
    void monthTotals().then((t) => {
      if (live) setTotals(t)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <section aria-label="Profiles" className="flex min-h-0 min-w-0 flex-col border-b border-line bg-panel md:border-b-0 md:border-l">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="pc-label">Profiles</span>
        <span className="flex-1" />
        <div className="relative">
          <button type="button" className="pc-btn is-sm" aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
            <IconPlus className="pc-i" aria-hidden="true" />
            Add
          </button>
          {adding && (
            <div
              role="menu"
              aria-label="Provider presets"
              className="absolute right-0 top-full z-10 mt-1 flex w-56 flex-col gap-0.5 rounded-lg border border-line bg-panel-raised p-1 shadow-pop"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAdding(false)
              }}
            >
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  role="menuitem"
                  className="pc-btn is-ghost is-sm justify-start"
                  onClick={async () => {
                    setAdding(false)
                    const profile = await addProfile(preset)
                    onSelect(profile.id)
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {profiles.length === 0 && <p className="pc-caption p-2">No providers yet. Add one to start prompting.</p>}
        {profiles.map((p) => {
          const caption = [p.defaultModel || 'No default model', isLocalBaseUrl(p.baseUrl) ? hostOf(p.baseUrl) : null].filter(Boolean).join(' · ')
          return (
            <button
              key={p.id}
              type="button"
              className="pc-version grid-cols-[minmax(0,1fr)_auto]"
              aria-current={p.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(p.id)}
            >
              <span className="pc-version-text">
                <span className="t">{p.name || 'Untitled profile'}</span>
                <span className="m pc-mono">{caption}</span>
              </span>
              {status[p.id] && <StatusBadge status={status[p.id]} />}
            </button>
          )
        })}
      </div>

      {profiles.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line p-4" data-testid="month-usage">
          <span className="pc-label">This month</span>
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{p.name || 'Untitled profile'}</span>
              <span className="pc-mono">{usageText(totals.get(p.id))}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
