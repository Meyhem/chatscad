import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Object3D } from 'three'
import type { MeshData } from '../render/types'
import { useTokens } from '../theme/tokens'
import { computeCameraFit } from '../viewer/cameraFit'
import { meshToGeometry } from '../viewer/geometry'

// OpenSCAD is Z-up; set before any camera exists, as the main viewer does.
Object3D.DEFAULT_UP.set(0, 0, 1)

const TOKENS = ['viewport', 'filament'] as const
const ASPECT = 4 / 3

/** Small orbitable preview inside a variant card; renders on demand only. */
export function VariantPreview({ mesh, label }: { mesh: MeshData; label: string }) {
  const t = useTokens(TOKENS)
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])
  const fit = useMemo(() => computeCameraFit(mesh.bounds, 45, ASPECT), [mesh])

  return (
    <div className="h-full w-full" role="img" aria-label={label}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 45, position: fit.position, near: Math.max(fit.distance / 1000, 0.01), far: fit.distance * 100 }}
      >
        <color attach="background" args={[t.viewport]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, -80, 100]} intensity={1.4} />
        <directionalLight position={[-60, 40, -30]} intensity={0.4} />
        <mesh geometry={geometry}>
          <meshStandardMaterial color={t.filament} roughness={0.6} metalness={0.1} />
        </mesh>
        <OrbitControls makeDefault target={fit.target} />
      </Canvas>
    </div>
  )
}
