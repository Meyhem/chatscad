import { create } from 'zustand'
import type { MeshData, RenderResult } from '../render/types'
import { listTaggableStatements, type StatementRange } from '../scad/statements'
import { useAppStore } from '../state/store'
import type { PickResult } from './pick'

export interface PartTags {
  /** The normal render these tags belong to; they are valid only while it is the app store's mesh. */
  baseMesh: MeshData
  code: string
  /** Same geometry as baseMesh, from the tagged render, with faceTags. */
  mesh: MeshData
  statements: StatementRange[]
}

export type PartTagsState = 'ready' | 'pending' | 'none'

export interface RefineState {
  tags: PartTags | null
  /** The base mesh a tagged render is running for. */
  pendingBase: MeshData | null
  pick: PickResult | null
  /** Returns a PNG data URL of the live viewport (registered by the viewer). */
  capture: (() => string) | null
  /** Called after each successful normal render; true means "request a tagged render now". */
  baseRendered(code: string, mesh: MeshData): boolean
  taggedFinished(result: RenderResult, code: string): void
  /** A newer render superseded the running tagged preview. */
  cancelPending(): void
  setPick(pick: PickResult | null): void
  setCapture(capture: (() => string) | null): void
}

export const useRefineStore = create<RefineState>()((set, get) => ({
  tags: null,
  pendingBase: null,
  pick: null,
  capture: null,
  baseRendered: (code, mesh) => {
    const statements = listTaggableStatements(code)
    if (statements.length === 1) {
      const faceTags = new Uint32Array(mesh.triangleCount).fill(statements[0].tag)
      set({ pick: null, pendingBase: null, tags: { baseMesh: mesh, code, statements, mesh: { ...mesh, faceTags } } })
      return false
    }
    const wanted = statements.length > 1
    set({ pick: null, tags: null, pendingBase: wanted ? mesh : null })
    return wanted
  },
  taggedFinished: (result, code) => {
    const base = get().pendingBase
    set({ pendingBase: null })
    if (!result.ok || !result.mesh.faceTags || base === null || useAppStore.getState().mesh !== base) return
    set({ tags: { baseMesh: base, code, mesh: result.mesh, statements: listTaggableStatements(code) } })
  },
  cancelPending: () => set({ pendingBase: null }),
  setPick: (pick) => set({ pick }),
  setCapture: (capture) => set({ capture }),
}))

export function partTagsState(mesh: MeshData | null, tags: PartTags | null, pendingBase: MeshData | null): PartTagsState {
  if (mesh === null) return 'none'
  if (tags?.baseMesh === mesh) return 'ready'
  return pendingBase === mesh ? 'pending' : 'none'
}
