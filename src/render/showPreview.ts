import { paramOverrides } from '../scad/customizer'
import { useAppStore } from '../state/store'
import type { MeshData, RenderRequest } from './types'

/**
 * Shows a quick-preview mesh only while the store still holds the code and parameters the request was built from.
 * The request carries just the overrides, so it is compared through paramOverrides and stored with the full params.
 */
export function showPreviewIfCurrent(req: RenderRequest, mesh: MeshData): void {
  const { code, params, showPreview } = useAppStore.getState()
  if (code !== req.code) return
  if (JSON.stringify(sorted(paramOverrides(code, params))) !== JSON.stringify(sorted(req.params ?? {}))) return
  showPreview({ code, params, mesh })
}

const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
