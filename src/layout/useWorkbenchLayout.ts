import { useEffect, useState } from 'react'
import { usePrefs } from '../settings/prefsStore'
import { clampColumns, type PanelLayout } from './panelLayout'

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/**
 * The desktop panel sizes: the saved layout, overridden live while a divider is dragged.
 * Columns are clamped to the window without overwriting what was saved.
 */
export function useWorkbenchLayout() {
  const saved = usePrefs((s) => s.panelLayout)
  const [draft, setDraft] = useState<PanelLayout | null>(null)
  const layout = draft ?? saved
  const windowWidth = useWindowWidth()
  const columns = clampColumns(layout, windowWidth)
  return {
    layout,
    columns,
    windowWidth,
    change: (patch: Partial<PanelLayout>) => setDraft({ ...layout, ...patch }),
    commit: (patch: Partial<PanelLayout>) => {
      setDraft(null)
      void usePrefs.getState().update({ panelLayout: { ...layout, ...patch } })
    },
  }
}
