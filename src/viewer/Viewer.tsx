import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AxesHelper, Color, Object3D, type PerspectiveCamera, type Vector3 } from 'three'
import type { Bounds, MeshData } from '../render/types'
import { useTokens } from '../theme/tokens'
import { DimsReadout } from '../ui/DimsReadout'
import { IconFit, IconWarning } from '../ui/icons'
import { computeCameraFit } from './cameraFit'
import { meshToGeometry } from './geometry'
import { staleText } from './staleText'
import { setThumbnailSource } from './thumbnail'

// OpenSCAD is Z-up. This must run before any camera or controls are created.
Object3D.DEFAULT_UP.set(0, 0, 1)

const TOKENS = ['viewport', 'filament', 'grid-minor', 'grid-major', 'axis-x', 'axis-y', 'axis-z', 'ink'] as const

/** The screens dim the last good model to 55 % while the current code fails (`scene.is-stale`). */
const STALE_OPACITY = 0.55

function Model({ mesh, color, stale }: { mesh: MeshData; color: string; stale: boolean }) {
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} transparent={stale} opacity={stale ? STALE_OPACITY : 1} />
    </mesh>
  )
}

/** three.js's AxesHelper ships fixed RGB; recolour it from the axis tokens. */
function Axes({ colors }: { colors: readonly [string, string, string] }) {
  const ref = useRef<AxesHelper>(null)
  const [x, y, z] = colors
  useEffect(() => {
    ref.current?.setColors(new Color(x), new Color(y), new Color(z))
  }, [x, y, z])
  return <axesHelper ref={ref} args={[20]} />
}

interface ControlsLike {
  target: Vector3
  update(): void
}

/** Fits the camera to the first mesh only (and on each Fit request), so re-renders keep the user's camera. */
function CameraFitter({ bounds, fitToken }: { bounds: Bounds | null; fitToken: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const fittedToken = useRef<number | null>(null)

  useEffect(() => {
    if (!bounds || !controls || fittedToken.current === fitToken) return
    fittedToken.current = fitToken
    const fit = computeCameraFit(bounds, camera.fov, size.height > 0 ? size.width / size.height : 1)
    camera.position.set(...fit.position)
    camera.near = Math.max(fit.distance / 1000, 0.01)
    camera.far = fit.distance * 100
    camera.updateProjectionMatrix()
    controls.target.set(...fit.target)
    controls.update()
    invalidate()
  }, [bounds, fitToken, controls, camera, size, invalidate])

  return null
}

/** Lets captureThumbnail() render this scene on demand and read the canvas in the same task. */
function ThumbnailRegistrar() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    setThumbnailSource(() => {
      gl.render(scene, camera)
      return gl.domElement
    })
    return () => setThumbnailSource(null)
  }, [gl, scene, camera])
  return null
}

export function Viewer({
  mesh,
  stale,
  thumbnails = false,
  staleLabel = null,
}: {
  mesh: MeshData | null
  stale: boolean
  thumbnails?: boolean
  staleLabel?: string | null
}) {
  const t = useTokens(TOKENS)
  const [fitToken, setFitToken] = useState(0)
  const axisColors = [t['axis-x'], t['axis-y'], t['axis-z']] as const

  return (
    <div className="relative h-full w-full bg-viewport" data-testid="viewer">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 45, near: 0.1, far: 10_000, position: [60, -80, 60] }}>
        <color attach="background" args={[t.viewport]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, -80, 100]} intensity={1.4} />
        <directionalLight position={[-60, 40, -30]} intensity={0.4} />
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          infiniteGrid
          cellSize={1}
          sectionSize={10}
          cellColor={t['grid-minor']}
          sectionColor={t['grid-major']}
          fadeDistance={400}
        />
        <Axes colors={axisColors} />
        {mesh && <Model mesh={mesh} color={t.filament} stale={stale} />}
        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[48, 48]}>
          <GizmoViewport axisColors={[...axisColors]} labelColor={t.ink} />
        </GizmoHelper>
        <CameraFitter bounds={mesh?.bounds ?? null} fitToken={fitToken} />
        {thumbnails && <ThumbnailRegistrar />}
      </Canvas>

      <div className="absolute top-3 left-3">
        {stale ? (
          <span className="pc-status is-warn">
            <IconWarning className="pc-i" aria-hidden="true" />
            {staleText(staleLabel)}
          </span>
        ) : (
          mesh && <DimsReadout bounds={mesh.bounds} axes />
        )}
      </div>

      <div className="absolute top-3 right-3">
        <button
          type="button"
          aria-label="Fit view"
          title="Fit view"
          className="grid size-(--control-sm) place-items-center rounded-sm border border-line bg-panel text-ink-muted hover:text-ink disabled:text-ink-disabled"
          onClick={() => setFitToken((n) => n + 1)}
          disabled={!mesh}
        >
          <IconFit className="pc-i" aria-hidden="true" />
        </button>
      </div>

      {mesh && (
        <div className="pc-caption pc-mono absolute bottom-3 left-3">
          {mesh.triangleCount.toLocaleString('en-US')} triangles
        </div>
      )}
    </div>
  )
}
