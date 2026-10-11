import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { SHOW_CHAT_EVENT } from '../refine/focusComposer'
import { useAppStore } from '../state/store'
import { IconBox, IconChat, IconCode } from '../ui/icons'
import { ParamSheet } from './ParamSheet'

export type PhoneTab = 'chat' | 'code' | '3d'

const TABS: Array<{ id: PhoneTab; label: string; Icon: typeof IconChat }> = [
  { id: 'chat', label: 'Chat', Icon: IconChat },
  { id: 'code', label: 'Code', Icon: IconCode },
  { id: '3d', label: '3D', Icon: IconBox },
]

interface Props {
  header: ReactNode
  chat: ReactNode
  code: ReactNode
  keyRow: ReactNode
  /** Rendered once and kept mounted; `paused` is true while the 3D tab is hidden. */
  viewer(paused: boolean): ReactNode
  params: ReactNode | null
  overlays?: ReactNode
}

export function PhoneLayout({ header, chat, code, keyRow, viewer, params, overlays }: Props) {
  const [tab, setTab] = useState<PhoneTab>('chat')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const reveal = useAppStore((s) => s.reveal)

  useEffect(() => {
    if (reveal) setTab('code')
  }, [reveal])

  // "Ask AI" from the 3D tab: the composer must be visible before it can take focus.
  useEffect(() => {
    const showChat = () => flushSync(() => setTab('chat'))
    window.addEventListener(SHOW_CHAT_EVENT, showChat)
    return () => window.removeEventListener(SHOW_CHAT_EVENT, showChat)
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1
    if (next < 0) return
    e.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  const panel = (id: PhoneTab) => ({
    id: `phone-panel-${id}`,
    role: 'tabpanel' as const,
    'aria-labelledby': `phone-tab-${id}`,
    hidden: tab !== id,
    className: 'flex h-full min-h-0 flex-col',
  })

  return (
    <div className="pc-root flex h-full flex-col bg-bg text-ink">
      {header}
      <div className="relative min-h-0 flex-1 bg-panel">
        <section {...panel('chat')}>{chat}</section>
        <section {...panel('code')}>
          <div className="min-h-0 flex-1">{code}</div>
          {keyRow}
        </section>
        <section {...panel('3d')}>
          <div className="min-h-0 flex-1">{viewer(tab !== '3d')}</div>
          {params && <ParamSheet>{params}</ParamSheet>}
        </section>
      </div>
      <nav role="tablist" aria-label="Views" className="pc-tabbar box-content shrink-0 pb-[env(safe-area-inset-bottom)]" onKeyDown={onKeyDown}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`phone-tab-${t.id}`}
            aria-controls={`phone-panel-${t.id}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className="pc-tab"
            onClick={() => setTab(t.id)}
          >
            <t.Icon className="pc-i" aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </nav>
      {overlays}
    </div>
  )
}
