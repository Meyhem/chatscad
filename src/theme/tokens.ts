import { useEffect, useState } from 'react'

/** Computed value of a design token (`--name`) on <html>, trimmed. Empty string if unset. */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
}

function readAll<N extends string>(names: readonly N[]): Record<N, string> {
  return Object.fromEntries(names.map((n) => [n, readToken(n)])) as Record<N, string>
}

/**
 * Token values for code that cannot use CSS variables (WebGL materials, canvas).
 * Re-reads when the OS colour scheme flips or `data-theme` changes on <html>.
 */
export function useTokens<N extends string>(names: readonly N[]): Record<N, string> {
  const key = names.join(',')
  const [values, setValues] = useState(() => readAll(names))

  useEffect(() => {
    const update = () => setValues(readAll(key.split(',') as N[]))
    update()
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
    media?.addEventListener('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media?.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [key])

  return values
}
