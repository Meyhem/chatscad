import { useEffect, useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { subsetMesh, type PickResult } from '../refine/pick'
import type { Bounds, MeshData, Vec3 } from '../render/types'
import { meshToGeometry } from './geometry'

/** Refine screen: `.pick-fill { opacity: 0.22 }`. */
export const PICK_FILL_OPACITY = 0.22
const REGION_FILL_OPACITY = 0.12
const EDGE_THRESHOLD_DEG = 30
const MIN_SIDE = 0.01

export function boxFor(bounds: Bounds): { center: Vec3; size: Vec3 } {
  const axes = [0, 1, 2] as const
  return {
    center: axes.map((a) => (bounds.min[a] + bounds.max[a]) / 2) as Vec3,
    size: axes.map((a) => Math.max(bounds.max[a] - bounds.min[a], MIN_SIDE)) as Vec3,
  }
}

export function PickHighlight({ pick, mesh, color }: { pick: PickResult; mesh: MeshData; color: string }) {
  const part = useMemo(() => (pick.kind === 'part' ? meshToGeometry(subsetMesh(mesh, pick.triangles)) : null), [pick, mesh])
  const box = useMemo(() => (pick.kind === 'box' ? boxFor(pick.bounds) : null), [pick])
  const boxGeometry = useMemo(() => (box ? new BoxGeometry(...box.size) : null), [box])
  const solid = part ?? boxGeometry
  const edges = useMemo(() => (solid ? new EdgesGeometry(solid, EDGE_THRESHOLD_DEG) : null), [solid])
  useEffect(
    () => () => {
      part?.dispose()
      boxGeometry?.dispose()
      edges?.dispose()
    },
    [part, boxGeometry, edges],
  )

  if (!solid || !edges) return null
  return (
    <group position={box ? box.center : [0, 0, 0]}>
      <mesh geometry={solid} renderOrder={1}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={part ? PICK_FILL_OPACITY : REGION_FILL_OPACITY}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      <lineSegments geometry={edges} renderOrder={2}>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  )
}
