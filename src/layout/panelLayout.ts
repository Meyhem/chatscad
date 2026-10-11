/** Desktop panel sizes in px. A null dock height means "as tall as its content, up to 45 % of the column". */
export interface PanelLayout {
  chatWidth: number
  codeWidth: number
  dockHeight: number | null
  consoleHeight: number
}

export const DEFAULT_LAYOUT: PanelLayout = { chatWidth: 360, codeWidth: 440, dockHeight: null, consoleHeight: 176 }

export const LIMITS = {
  chat: [280, 560],
  code: [320, 720],
  dock: [96, 1200],
  console: [72, 1200],
  /** The 3D view keeps at least this width between the two columns. */
  minViewerWidth: 360,
  /** The viewer and the editor keep at least this height above the dock and the console. */
  minAbove: 160,
} as const

/** Width of the two 1 px dividers between the columns. */
const DIVIDERS = 2

const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, Math.round(v)))

/** Column widths that fit `windowWidth`: the code column gives way first, then chat, never below their minimums. */
export function clampColumns(layout: PanelLayout, windowWidth: number): { chatWidth: number; codeWidth: number } {
  const room = windowWidth - DIVIDERS - LIMITS.minViewerWidth
  const codeWidth = clamp(Math.min(layout.codeWidth, room - layout.chatWidth), LIMITS.code)
  const chatWidth = clamp(Math.min(layout.chatWidth, room - codeWidth), LIMITS.chat)
  return { chatWidth, codeWidth }
}

type Column = 'chat' | 'code'
type Columns = { chatWidth: number; codeWidth: number }

/** Room for chat and code together while the 3D view keeps its minimum width. */
const columnRoom = (windowWidth: number) => windowWidth - DIVIDERS - LIMITS.minViewerWidth

/** The widest a column can be dragged: its own limit, or what is left once the other column is at its minimum. */
export function columnMax(column: Column, windowWidth: number): number {
  const [min, max] = LIMITS[column]
  const other = LIMITS[column === 'chat' ? 'code' : 'chat'][0]
  return Math.max(min, Math.min(max, columnRoom(windowWidth) - other))
}

/** Widths after dragging one column to `value`: the other column gives way, down to its minimum. */
export function resizeColumn(column: Column, value: number, windowWidth: number, shown: Columns): Columns {
  const room = columnRoom(windowWidth)
  const size = clamp(Math.min(value, columnMax(column, windowWidth)), LIMITS[column])
  if (column === 'chat') return { chatWidth: size, codeWidth: clamp(Math.min(shown.codeWidth, room - size), LIMITS.code) }
  return { codeWidth: size, chatWidth: clamp(Math.min(shown.chatWidth, room - size), LIMITS.chat) }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A stored layout, validated: anything malformed gives the defaults, out-of-range sizes are clamped. */
export function layoutFrom(value: unknown): PanelLayout {
  const v = value as Partial<Record<keyof PanelLayout, unknown>> | null | undefined
  if (!v || !num(v.chatWidth) || !num(v.codeWidth) || !num(v.consoleHeight) || !(v.dockHeight === null || num(v.dockHeight))) {
    return DEFAULT_LAYOUT
  }
  return {
    chatWidth: clamp(v.chatWidth, LIMITS.chat),
    codeWidth: clamp(v.codeWidth, LIMITS.code),
    dockHeight: v.dockHeight === null ? null : clamp(v.dockHeight, LIMITS.dock),
    consoleHeight: clamp(v.consoleHeight, LIMITS.console),
  }
}
