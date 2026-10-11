import { formatDimParts, formatDims } from '../render/dims'
import type { Bounds } from '../render/types'

/** Bounding-box size of the last good mesh. Inline in the header; axis form over the viewer. */
export function DimsReadout({ bounds, axes = false }: { bounds: Bounds; axes?: boolean }) {
  if (!axes) {
    return (
      <span className="pc-dims" data-testid="dims">
        {formatDims(bounds)}
      </span>
    )
  }
  const [x, y, z] = formatDimParts(bounds)
  return (
    <span className="pc-dims" data-testid="dims-axes" aria-label={formatDims(bounds)}>
      <span>
        <span className="x">X</span> {x}
      </span>
      <span>
        <span className="y">Y</span> {y}
      </span>
      <span>
        <span className="z">Z</span> {z}
      </span>
      <span className="pc-muted">mm</span>
    </span>
  )
}
