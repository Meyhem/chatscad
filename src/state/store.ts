import { create } from 'zustand'
import type { Diagnostic, LogLine, MeshData, RenderResult } from '../render/types'

export type RenderStatus = 'idle' | 'rendering' | 'ok' | 'error'

export interface RevealRequest {
  line: number
  id: number
}

export const DEFAULT_CODE = `// PromptCAD: edit me
/* [Dimensions] */
width = 20;  // [5:1:100]
depth = 20;  // [5:1:100]
height = 10; // [2:1:50]

difference() {
  cube([width, depth, height]);
  translate([width / 2, depth / 2, 2])
    cylinder(h = height, r = min(width, depth) / 4, $fn = 48);
}
`

export interface AppState {
  code: string
  status: RenderStatus
  /** Last successfully rendered mesh; kept on screen when a later render fails. */
  mesh: MeshData | null
  /** Binary STL matching `mesh`. */
  stl: ArrayBuffer | null
  /** The code that produced `mesh` and `stl`. */
  renderedCode: string | null
  logs: LogLine[]
  diagnostics: Diagnostic[]
  error: string | null
  renderMs: number | null
  /** Asks the editor to scroll to and select a line (status pill and console clicks). */
  reveal: RevealRequest | null
  setCode(code: string): void
  renderStarted(): void
  renderFinished(result: RenderResult, code: string): void
  goToLine(line: number): void
}

let revealId = 0

export const useAppStore = create<AppState>()((set) => ({
  code: DEFAULT_CODE,
  status: 'idle',
  mesh: null,
  stl: null,
  renderedCode: null,
  logs: [],
  diagnostics: [],
  error: null,
  renderMs: null,
  reveal: null,
  setCode: (code) => set({ code }),
  renderStarted: () => set({ status: 'rendering' }),
  renderFinished: (r, code) =>
    set(
      r.ok
        ? { status: 'ok', mesh: r.mesh, stl: r.stl, renderedCode: code, error: null, logs: r.logs, diagnostics: r.diagnostics, renderMs: r.renderMs }
        : { status: 'error', error: r.error, logs: r.logs, diagnostics: r.diagnostics, renderMs: r.renderMs },
    ),
  goToLine: (line) => set({ reveal: { line, id: ++revealId } }),
}))

/** STL export is allowed only when the file on hand was rendered from exactly the code in the editor. */
export const selectCanExport = (s: AppState): boolean =>
  s.status === 'ok' && s.stl !== null && s.renderedCode === s.code
