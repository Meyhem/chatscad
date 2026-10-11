import { act, renderHook, waitFor } from '@testing-library/react'
import { readToken, useTokens } from './tokens'

const values: Record<string, string> = { '--filament': ' #e9a23b ', '--viewport': '#0b0e12' }

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => values[name] ?? '',
  } as unknown as CSSStyleDeclaration)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

it('reads a trimmed token value from the root element', () => {
  expect(readToken('filament')).toBe('#e9a23b')
  expect(readToken('missing')).toBe('')
})

it('returns every requested token', () => {
  const { result } = renderHook(() => useTokens(['filament', 'viewport'] as const))
  expect(result.current).toEqual({ filament: '#e9a23b', viewport: '#0b0e12' })
})

it('re-reads when data-theme changes on <html>', async () => {
  const { result } = renderHook(() => useTokens(['filament'] as const))
  values['--filament'] = '#d4861a'
  act(() => document.documentElement.setAttribute('data-theme', 'light'))
  await waitFor(() => expect(result.current.filament).toBe('#d4861a'))
})
