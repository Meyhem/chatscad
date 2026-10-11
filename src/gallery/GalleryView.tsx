import { useMemo, useState } from 'react'
import { useProjectStore } from '../history/projectStore'
import { parseCustomizer } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { Glyph } from '../ui/Glyph'
import { IconSearch } from '../ui/icons'
import { CATEGORIES, EXAMPLES, type GalleryCategory, type GalleryExample } from './index'

type Tab = GalleryCategory | 'All'

const toWorkbench = () => useAppStore.getState().setView('workbench')

export function GalleryView() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('All')
  const [starting, setStarting] = useState<string | null>(null)
  const counts = useMemo(() => new Map(EXAMPLES.map((e) => [e.id, parseCustomizer(e.code).length])), [])

  const q = query.trim().toLowerCase()
  const shown = EXAMPLES.filter(
    (e) => (tab === 'All' || e.category === tab) && (q === '' || e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))),
  )

  const start = async (e: GalleryExample) => {
    setStarting(e.id)
    try {
      await useProjectStore.getState().newProject({ name: e.name, code: e.code, origin: 'gallery', source: 'gallery', message: `Started from ${e.name}` })
      toWorkbench()
    } finally {
      setStarting(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-line bg-panel pr-3 pl-4">
        <span className="text-[15px] font-bold tracking-tight">PromptCAD</span>
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        <span className="font-semibold">Examples</span>
        <span className="flex-1" />
        <button type="button" className="pc-btn is-sm" onClick={toWorkbench}>
          Back to project
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-4 py-6 md:px-12 md:py-8">
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex min-w-[min(320px,100%)] flex-1 flex-col gap-1.5">
            <h1 className="text-[20px] leading-[26px] font-semibold tracking-[-0.01em]">Start from a working model</h1>
            <p className="pc-muted">Every example is parametric and works offline. Starting from one copies it into a new project as version 1.</p>
          </div>
          <div className="pc-input w-full md:w-80">
            <IconSearch className="pc-i" aria-hidden="true" />
            <input placeholder="Search examples" aria-label="Search examples" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="pc-tabs self-start" role="tablist" aria-label="Categories">
          {(['All', ...CATEGORIES] as Tab[]).map((c) => (
            <button key={c} type="button" role="tab" className="pc-tab" aria-selected={tab === c} onClick={() => setTab(c)}>
              {c === 'All' ? `All ${EXAMPLES.length}` : c}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="pc-caption">No example matches “{query.trim()}”.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((e) => (
              <article key={e.id} className="pc-variant" aria-label={e.name} data-testid={`example-${e.id}`}>
                <span className="pc-variant-view">
                  <Glyph shapes={e.glyph} />
                </span>
                <span className="pc-variant-meta">
                  <span className="font-semibold">{e.name}</span>
                  <span className="pc-caption pc-mono">{counts.get(e.id)} params</span>
                </span>
                <span className="pc-row px-1">
                  {e.tags.map((t) => (
                    <span key={t} className="inline-flex h-5 items-center rounded-sm border border-line bg-inset px-1.5 text-[11px] font-medium text-ink-muted">
                      {t}
                    </span>
                  ))}
                </span>
                <button type="button" className="pc-btn is-sm" disabled={starting !== null} onClick={() => void start(e)}>
                  Start from this
                </button>
              </article>
            ))}
          </div>
        )}
        <p className="pc-caption">Want to add one? Examples are plain .scad files in the app's repository and can be added by pull request.</p>
      </main>
    </div>
  )
}
