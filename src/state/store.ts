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

export type CodeSource = 'manual' | 'ai' | 'autofix' | 'restore' | 'slider' | 'gallery' | 'import'

export interface AppState {
  code: string
  /** Who wrote the current code; an unchanged setCode keeps it. */
  codeSource: CodeSource
  status: RenderStatus
  /** Last successfully rendered mesh; kept on screen when a later render fails. */
  mesh: MeshData | null
  /** Binary STL matching `mesh`. */
  stl: ArrayBuffer | null
  /** The code that produced `mesh` and `stl`. */
  renderedCode: string | null
  /** The last finished render and the code it belongs to; awaitRender() reads it. */
  lastRender: { code: string; result: RenderResult } | null
  logs: LogLine[]
  diagnostics: Diagnostic[]
  error: string | null
  renderMs: number | null
  /** Asks the editor to scroll to and select a line (status pill and console clicks). */
  reveal: RevealRequest | null
  view: 'workbench' | 'settings' // M3 adds 'history' | 'gallery'
  setCode(code: string, source?: CodeSource): void // source defaults to 'manual'
  renderStarted(): void
  renderFinished(result: RenderResult, code: string): void
  goToLine(line: number): void
  setView(view: AppState['view']): void
}

let revealId = 0

export const useAppStore = create<AppState>()((set) => ({
  code: DEFAULT_CODE,
  codeSource: 'manual',
  status: 'idle',
  mesh: null,
  stl: null,
  renderedCode: null,
  lastRender: null,
  logs: [],
  diagnostics: [],
  error: null,
  renderMs: null,
  reveal: null,
  view: 'workbench',
  // Returning the same state object makes Zustand skip the update and its listeners.
  setCode: (code, source = 'manual') => set((s) => (s.code === code ? s : { code, codeSource: source })),
  renderStarted: () => set({ status: 'rendering' }),
  renderFinished: (r, code) =>
    set(
      r.ok
        ? {
            status: 'ok',
            mesh: r.mesh,
            stl: r.stl,
            renderedCode: code,
            lastRender: { code, result: r },
            error: null,
            logs: r.logs,
            diagnostics: r.diagnostics,
            renderMs: r.renderMs,
          }
        : { status: 'error', lastRender: { code, result: r }, error: r.error, logs: r.logs, diagnostics: r.diagnostics, renderMs: r.renderMs },
    ),
  goToLine: (line) => set({ reveal: { line, id: ++revealId } }),
  setView: (view) => set({ view }),
}))

/** STL export is allowed only when the file on hand was rendered from exactly the code in the editor. */
export const selectCanExport = (s: AppState): boolean =>
  s.status === 'ok' && s.stl !== null && s.renderedCode === s.code
