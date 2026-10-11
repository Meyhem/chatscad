import { useRef, type KeyboardEvent } from 'react'
import { useAppStore } from '../state/store'
import { IconBox, IconHistory, IconSettings } from '../ui/icons'

export type TabView = 'workbench' | 'history' | 'settings'

const TABS: Array<{ view: TabView; label: string; Icon: typeof IconBox }> = [
  { view: 'workbench', label: 'Project', Icon: IconBox },
  { view: 'history', label: 'History', Icon: IconHistory },
  { view: 'settings', label: 'Settings', Icon: IconSettings },
]

export const viewPanelId = (view: TabView) => `view-panel-${view}`

/** Project / History / Settings. The same strip on every view, so the way back is always the same click. */
export function ViewTabs({ fill = false }: { fill?: boolean }) {
  const view = useAppStore((s) => s.view)
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.view === view)
    const next = (i + step + TABS.length) % TABS.length
    useAppStore.getState().setView(TABS[next].view)
    refs.current[next]?.focus()
  }

  return (
    <nav role="tablist" aria-label="Views" className={`pc-tabs${fill ? ' grid w-full grid-cols-3' : ''}`} onKeyDown={onKeyDown}>
      {TABS.map((t, i) => (
        <button
          key={t.view}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="tab"
          id={`view-tab-${t.view}`}
          aria-controls={viewPanelId(t.view)}
          aria-selected={view === t.view}
          tabIndex={view === t.view ? 0 : -1}
          className={`pc-tab${fill ? ' h-10 justify-center' : ''}`}
          onClick={() => useAppStore.getState().setView(t.view)}
        >
          <t.Icon className="pc-i" aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </nav>
  )
}
