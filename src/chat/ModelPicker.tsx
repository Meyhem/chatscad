import { useEffect, useRef, useState } from 'react'
import type { ProviderProfile } from '../db/db'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { IconChevron, IconSearch } from '../ui/icons'
import { fuzzyFilter, fuzzyScore, isStrongMatch } from './fuzzy'

const MAX_PER_PROFILE = 50

export function modelIds(profile: ProviderProfile): string[] {
  const ids = profile.cachedModels.map((m) => m.id)
  const fallback = profile.defaultModel.trim()
  return fallback !== '' && !ids.includes(fallback) ? [fallback, ...ids] : ids
}

interface Group {
  profile: ProviderProfile
  keys(id: string): string[]
  ids: string[]
}

/**
 * The model Enter selects, or null to use the typed text. An exact id anywhere wins. A full id ("vendor/model")
 * that is not listed stays as typed, and so does a query that only matches loosely (scattered letters or typos);
 * otherwise the best-scoring match across profiles.
 */
function pickForEnter(typed: string, groups: Group[]): { profileId: string; id: string } | null {
  for (const g of groups) if (g.ids.includes(typed)) return { profileId: g.profile.id, id: typed }
  if (typed.includes('/')) return null
  let best: { profileId: string; id: string; score: number } | null = null
  for (const g of groups) {
    const id = g.ids[0]
    if (!isStrongMatch(typed, g.keys(id))) continue
    const score = fuzzyScore(typed, g.keys(id)) ?? -Infinity
    if (!best || score > best.score) best = { profileId: g.profile.id, id, score }
  }
  return best
}

export function ModelPicker() {
  const profiles = useProvidersStore((s) => s.profiles)
  const active = useProvidersStore(selectActiveProfile)
  const model = useProvidersStore(selectActiveModel)
  const chooseModel = useProvidersStore((s) => s.chooseModel)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (profiles.length === 0) {
    return (
      <button type="button" className="pc-model" disabled>
        No model
      </button>
    )
  }

  const typed = query.trim()
  const groups = profiles
    .map((p) => {
      const names = new Map(p.cachedModels.map((m) => [m.id, m.name ?? '']))
      const keys = (id: string) => [id, names.get(id) ?? '']
      return { profile: p, keys, ids: fuzzyFilter(typed, modelIds(p), keys).slice(0, MAX_PER_PROFILE) }
    })
    .filter((g) => g.ids.length > 0)
  const enterPick = pickForEnter(typed, groups)
  const pick = (profileId: string, id: string) => {
    void chooseModel(profileId, id)
    setOpen(false)
    setQuery('')
  }
  const offerTyped = typed !== '' && active !== null && !modelIds(active).includes(typed)

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        className="pc-model max-w-full"
        aria-label={`Model: ${model ?? 'none'}`}
        title={model ?? undefined}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 truncate">{model ?? 'Choose a model'}</span>
        <IconChevron className="pc-i" aria-hidden="true" />
      </button>
      {open && (
        <div
          data-testid="model-menu"
          className="absolute bottom-full left-0 z-10 mb-2 flex max-h-80 w-72 flex-col gap-2 overflow-y-auto rounded-lg border border-line bg-panel-raised p-2 shadow-pop"
        >
          <div className="pc-input is-mono">
            <IconSearch className="pc-i" aria-hidden="true" />
            <input
              autoFocus
              aria-label="Search models"
              placeholder="Search or type a model name"
              value={query}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || typed === '') return
                if (enterPick) {
                  e.preventDefault()
                  pick(enterPick.profileId, enterPick.id)
                } else if (active) {
                  e.preventDefault()
                  pick(active.id, typed)
                }
              }}
            />
          </div>
          {groups.map(({ profile: p, ids }) => (
            <div key={p.id} role="group" aria-label={p.name} className="flex flex-col">
              <span className="pc-label px-2 py-1">{p.name}</span>
              {ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="pc-btn is-ghost is-sm justify-start font-mono"
                  aria-pressed={p.id === active?.id && id === model}
                  onClick={() => pick(p.id, id)}
                >
                  {id}
                </button>
              ))}
            </div>
          ))}
          {offerTyped && active && (
            <button type="button" className="pc-btn is-sm justify-start" onClick={() => pick(active.id, typed)}>
              Use “{typed}” with {active.name}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
