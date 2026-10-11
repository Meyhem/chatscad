import { useEffect, useState, type RefObject } from 'react'

/** The element's current height in px, kept up to date while it resizes (0 before layout or without ResizeObserver). */
export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setHeight(el.offsetHeight)
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return height
}
