import type { ThemeSetting } from '../db/db'

/** tokens.css: dark is :root, light via [data-theme="light"] or the OS; [data-theme="dark"] forces dark. */
export function applyTheme(theme: ThemeSetting, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = theme
}
