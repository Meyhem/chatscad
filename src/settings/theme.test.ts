import { formatBytes } from './format'
import { applyTheme } from './theme'

it('sets data-theme for dark and light and removes it for system', () => {
  const root = document.createElement('html')
  applyTheme('light', root)
  expect(root.dataset.theme).toBe('light')
  applyTheme('dark', root)
  expect(root.dataset.theme).toBe('dark')
  applyTheme('system', root)
  expect(root.hasAttribute('data-theme')).toBe(false)
  expect(() => applyTheme('dark', null)).not.toThrow()
})

it('formats byte counts with units', () => {
  expect(formatBytes(512 * 1024)).toBe('512 KB')
  expect(formatBytes(12.4 * 1024 * 1024)).toBe('12.4 MB')
  expect(formatBytes(2.1 * 1024 ** 3)).toBe('2.1 GB')
  expect(formatBytes(0)).toBe('0 KB')
})
