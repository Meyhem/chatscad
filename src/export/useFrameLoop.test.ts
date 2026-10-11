import { act, renderHook } from '@testing-library/react'
import { useFrameLoop } from './useFrameLoop'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

it('advances one frame per delay and wraps', () => {
  const { result } = renderHook(() => useFrameLoop(3, 100, true))
  expect(result.current).toBe(0)
  act(() => vi.advanceTimersByTime(100))
  expect(result.current).toBe(1)
  act(() => vi.advanceTimersByTime(100))
  act(() => vi.advanceTimersByTime(100))
  expect(result.current).toBe(0)
})

it('holds still when not playing', () => {
  const { result } = renderHook(() => useFrameLoop(3, 100, false))
  act(() => vi.advanceTimersByTime(500))
  expect(result.current).toBe(0)
})

it('pauses while the page is hidden', () => {
  const { result } = renderHook(() => useFrameLoop(3, 100, true))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  act(() => vi.advanceTimersByTime(500))
  expect(result.current).toBe(0)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  act(() => vi.advanceTimersByTime(100))
  expect(result.current).toBe(1)
})

it('keeps the index inside a shrinking frame list', () => {
  const { result, rerender } = renderHook(({ n }) => useFrameLoop(n, 100, true), { initialProps: { n: 5 } })
  for (let i = 0; i < 4; i++) act(() => vi.advanceTimersByTime(100))
  expect(result.current).toBe(4)
  rerender({ n: 2 })
  expect(result.current).toBeLessThan(2)
})

it('keeps playing while more frames arrive', () => {
  const { result, rerender } = renderHook(({ n }) => useFrameLoop(n, 100, true), { initialProps: { n: 2 } })
  for (let n = 3; n <= 8; n++) {
    act(() => vi.advanceTimersByTime(60))
    rerender({ n })
  }
  expect(result.current).toBeGreaterThan(1)
})
