import { useEffect, useRef, useState } from 'react'
import type { ProviderProfile } from '../db/db'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { IconChevron, IconSearch } from '../ui/icons'
import { fuzzyFilter } from './fuzzy'

const MAX_PER_PROFILE = 50

export function modelIds(profile: ProviderProfile): string[] {
  const ids = profile.cachedModels.map((m) => m.id)
  const fallback = profile.defaultModel.trim()
  return fallback !== '' && !ids.includes(fallback) ? [fallback, ...ids] : ids
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
      return { profile: p, ids: fuzzyFilter(typed, modelIds(p), (id) => [id, names.get(id) ?? '']).slice(0, MAX_PER_PROFILE) }
    })
    .filter((g) => g.ids.length > 0)
  const top = typed !== '' ? groups[0] : undefined
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
                if (top) {
                  e.preventDefault()
                  pick(top.profile.id, top.ids[0])
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
