import { clampColumns, DEFAULT_LAYOUT, layoutFrom } from './panelLayout'

it('keeps stored widths when they fit', () => {
  expect(clampColumns({ ...DEFAULT_LAYOUT, chatWidth: 400, codeWidth: 500 }, 1600)).toEqual({ chatWidth: 400, codeWidth: 500 })
})

it('shrinks the code column first so the 3D view keeps 360 px', () => {
  // 1200 − 2 px of dividers − 400 chat − 360 view = 438 for code.
  expect(clampColumns({ ...DEFAULT_LAYOUT, chatWidth: 400, codeWidth: 700 }, 1200)).toEqual({ chatWidth: 400, codeWidth: 438 })
})

it('then shrinks the chat column', () => {
  expect(clampColumns({ ...DEFAULT_LAYOUT, chatWidth: 560, codeWidth: 720 }, 1100)).toEqual({ chatWidth: 418, codeWidth: 320 })
})

it('never goes below the column minimums', () => {
  expect(clampColumns({ ...DEFAULT_LAYOUT, chatWidth: 560, codeWidth: 720 }, 800)).toEqual({ chatWidth: 280, codeWidth: 320 })
})

it('falls back to defaults for a broken stored value, and clamps out-of-range sizes', () => {
  expect(layoutFrom(undefined)).toEqual(DEFAULT_LAYOUT)
  expect(layoutFrom({ chatWidth: 'wide' })).toEqual(DEFAULT_LAYOUT)
  expect(layoutFrom({ chatWidth: 9999, codeWidth: 100, dockHeight: 10, consoleHeight: 200 })).toEqual({
    chatWidth: 560,
    codeWidth: 320,
    dockHeight: 96,
    consoleHeight: 200,
  })
  expect(layoutFrom({ ...DEFAULT_LAYOUT, dockHeight: null }).dockHeight).toBeNull()
})
