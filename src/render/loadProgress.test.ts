import {
  emitLoadProgress,
  formatLoadProgress,
  isLoadProgressMessage,
  LOAD_PROGRESS_TYPE,
  loadProgressMessage,
  onLoadProgress,
  throttleProgress,
} from './loadProgress'

it('formats downloaded and total megabytes, or only the downloaded part when the total is unknown', () => {
  expect(formatLoadProgress({ loaded: 5_200_000, total: 8_400_000 })).toBe('5.2 / 8.4 MB')
  expect(formatLoadProgress({ loaded: 5_200_000, total: null })).toBe('5.2 MB')
})

it('recognises only well-formed progress messages, never Comlink replies', () => {
  expect(isLoadProgressMessage(loadProgressMessage({ loaded: 1, total: 2 }))).toBe(true)
  expect(isLoadProgressMessage(loadProgressMessage({ loaded: 1, total: null }))).toBe(true)
  expect(isLoadProgressMessage({ type: LOAD_PROGRESS_TYPE, loaded: '1', total: 2 })).toBe(false)
  expect(isLoadProgressMessage({ id: 'abc', type: 'RETURN', value: 1 })).toBe(false)
  expect(isLoadProgressMessage(null)).toBe(false)
})

it('throttles to one report per step, always reporting the first and the complete one', () => {
  const seen: number[] = []
  const report = throttleProgress((p) => seen.push(p.loaded), 100)
  for (const loaded of [0, 50, 120, 150, 260, 300]) report({ loaded, total: 300 })
  expect(seen).toEqual([0, 120, 260, 300])
})

it('delivers progress to subscribers until they unsubscribe', () => {
  const listener = vi.fn()
  const off = onLoadProgress(listener)
  emitLoadProgress({ loaded: 1, total: null })
  off()
  emitLoadProgress({ loaded: 2, total: null })
  expect(listener).toHaveBeenCalledExactlyOnceWith({ loaded: 1, total: null })
})
