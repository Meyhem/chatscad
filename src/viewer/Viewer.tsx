import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AxesHelper, BufferAttribute, Color, Object3D, type PerspectiveCamera, type Vector3 } from 'three'
import { useAgentStore } from '../agent/agentStore'
import { faceColourArray, PART_COLOUR_COUNT } from '../agent/partColours'
import { buildLegend } from '../agent/review'
import { Legend } from '../agent/ui/Legend'
import { PartColoursToggle } from '../agent/ui/PartColoursToggle'
import { ReferencePhoto } from '../photos/ReferencePhoto'
import { focusComposer } from '../refine/focusComposer'
import { isTap, resolvePick, type ScreenPoint } from '../refine/pick'
import { PickPopover } from '../refine/PickPopover'
import { partTagsState, useRefineStore } from '../refine/refineStore'
import { useEscapeToClearPick } from '../refine/useEscapeToClearPick'
import { useVisionSupport } from '../refine/useVisionSupport'
import type { Bounds, MeshData } from '../render/types'
import { useAppStore } from '../state/store'
import { useTokens } from '../theme/tokens'
import { DimsReadout } from '../ui/DimsReadout'
import { EmptyModelCard } from './EmptyModelCard'
import { IconFit, IconSpinner, IconWarning } from '../ui/icons'
import { TriangleWarning } from './TriangleWarning'
import { computeCameraFit } from './cameraFit'
import { meshToGeometry } from './geometry'
import { PickHighlight } from './PickHighlight'
import { usePoseRequest } from './poseRequest'
import { staleText } from './staleText'
import { poseFromCamera, setViewerPose } from './viewerCamera'
import { setThumbnailSource } from './thumbnail'
import { ViewportCapture } from './ViewportCapture'

// OpenSCAD is Z-up. This must run before any camera or controls are created.
Object3D.DEFAULT_UP.set(0, 0, 1)

const PART_TOKENS = [...Array.from({ length: PART_COLOUR_COUNT }, (_, i) => `part-${i + 1}` as const), 'part-none'] as const
const TOKENS = ['viewport', 'filament', 'grid-minor', 'grid-major', 'axis-x', 'axis-y', 'axis-z', 'ink', 'pick', ...PART_TOKENS] as const

/** The screens dim the last good model to 55 % while the current code fails (`scene.is-stale`). */
const STALE_OPACITY = 0.55

function Model({
  mesh,
  color,
  colours,
  stale,
  onTap,
}: {
  mesh: MeshData
  color: string
  /** Per-vertex part colours; the filament colour when absent. */
  colours?: Float32Array | null
  stale: boolean
  onTap?(faceIndex: number, at: ScreenPoint): void
}) {
  const geometry = useMemo(() => {
    const g = meshToGeometry(mesh)
    if (colours) g.setAttribute('color', new BufferAttribute(colours, 3))
    return g
  }, [mesh, colours])
  useEffect(() => () => geometry.dispose(), [geometry])
  // R3F raycasts click-only meshes on click, never on pointer moves.
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onTap || typeof e.faceIndex !== 'number') return
    e.stopPropagation()
    onTap(e.faceIndex, { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  return (
    <mesh geometry={geometry} onClick={onTap ? handleClick : undefined}>
      <meshStandardMaterial
        key={colours ? 'parts' : 'filament'}
        color={colours ? 'white' : color}
        vertexColors={Boolean(colours)}
        roughness={0.6}
        metalness={0.1}
        transparent={stale}
        opacity={stale ? STALE_OPACITY : 1}
      />
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
    // A tap right after Fit view raycasts before the next frame; give it the fitted camera now.
    camera.updateMatrixWorld()
    invalidate()
  }, [bounds, fitToken, controls, camera, size, invalidate])

  return null
}

/** Moves the camera to a pose asked for from outside the canvas, such as a reference photo's angle. */
function PoseApplier() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null
  const invalidate = useThree((s) => s.invalidate)
  const pose = usePoseRequest((s) => s.pose)
  const token = usePoseRequest((s) => s.token)
  // A viewer that mounts later (another tab, another project) must not replay an old request.
  const applied = useRef(token)
  useEffect(() => {
    if (!pose || !controls || token === applied.current) return
    applied.current = token
    camera.up.set(...(pose.up ?? [0, 0, 1]))
    camera.position.set(...pose.position)
    controls.target.set(...pose.target)
    controls.update()
    camera.updateMatrixWorld()
    invalidate()
  }, [pose, token, controls, camera, invalidate])
  return null
}

interface ControlsWithEvents extends ControlsLike {
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

/** Reports the orbit pose so the PNG export can use "Current view". */
function PoseReporter() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as ControlsWithEvents | null
  const size = useThree((s) => s.size)
  useEffect(() => {
    if (!controls) return
    const save = () => {
      const pose = poseFromCamera(camera, controls.target, size)
      if (pose) setViewerPose(pose)
    }
    save()
    controls.addEventListener('change', save)
    return () => controls.removeEventListener('change', save)
  }, [camera, controls, size])
  // Forget the pose only when the viewer goes away, not when it is hidden or resized.
  useEffect(() => () => setViewerPose(null), [])
  return null
}

/** Redraws once when the hidden 3D tab is shown again. */
function ResumeOnShow({ paused }: { paused: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!paused) invalidate()
  }, [paused, invalidate])
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
  previewing = false,
  paused = false,
  refine = false,
  empty = false,
}: {
  mesh: MeshData | null
  stale: boolean
  thumbnails?: boolean
  staleLabel?: string | null
  previewing?: boolean
  paused?: boolean
  /** Click-to-refine: tap a part of the workbench model (M5). Off for other viewers, such as History's. */
  refine?: boolean
  /** The editor holds no code: show the empty state over the grid. */
  empty?: boolean
}) {
  const t = useTokens(TOKENS)
  const [fitToken, setFitToken] = useState(0)
  const axisColors = [t['axis-x'], t['axis-y'], t['axis-z']] as const

  const pointerDown = useRef<ScreenPoint | null>(null)
  const tags = useRefineStore((s) => s.tags)
  const pendingBase = useRefineStore((s) => s.pendingBase)
  const storePick = useRefineStore((s) => s.pick)
  const setPick = useRefineStore((s) => s.setPick)
  const current = useAppStore((s) => s.status === 'ok' && s.renderedCode === s.code)
  const goToLine = useAppStore((s) => s.goToLine)
  const vision = useVisionSupport()
  useEscapeToClearPick()
  const tagState = refine ? partTagsState(mesh, tags, pendingBase) : 'none'
  const pick = refine ? storePick : null
  const shown = refine && tags && tagState === 'ready' ? tags.mesh : mesh
  const partColoursOn = useAgentStore((s) => s.partColours)
  const partsReady = refine && tags !== null && tagState === 'ready' && shown?.faceTags !== undefined && !stale
  const showParts = partsReady && partColoursOn
  const palette = PART_TOKENS.map((n) => t[n])
  const paletteKey = palette.join(',')
  const colours = useMemo(
    () => (showParts && shown?.faceTags ? faceColourArray(shown.faceTags, paletteKey.split(',').slice(0, PART_COLOUR_COUNT), paletteKey.split(',')[PART_COLOUR_COUNT]) : null),
    [showParts, shown, paletteKey],
  )
  const legend = useMemo(() => (showParts && tags && shown?.faceTags ? buildLegend(tags.code, shown.faceTags) : null), [showParts, tags, shown])
  const canPick = refine && shown !== null && !stale && !previewing && current && tagState !== 'pending'
  const onTap = (faceIndex: number, at: ScreenPoint) => {
    if (!canPick || !shown || !isTap(pointerDown.current, at)) return
    const statements = tags && tagState === 'ready' ? tags.statements : []
    setPick(resolvePick({ mesh: shown, faceIndex, statements, code: useAppStore.getState().code }))
  }
  const onMissed = (e: MouseEvent) => {
    if (refine && isTap(pointerDown.current, { x: e.clientX, y: e.clientY })) setPick(null)
  }

  return (
    <div
      className="relative h-full w-full bg-viewport"
      data-testid="viewer"
      data-part-tags={refine ? tagState : undefined}
      onPointerDown={(e) => {
        pointerDown.current = { x: e.clientX, y: e.clientY }
      }}
    >
      <Canvas
        frameloop={paused ? 'never' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.1, far: 10_000, position: [60, -80, 60] }}
        onPointerMissed={onMissed}
      >
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
        {shown && <Model mesh={shown} color={t.filament} colours={colours} stale={stale} onTap={refine ? onTap : undefined} />}
        {pick && shown && <PickHighlight pick={pick} mesh={shown} color={t.pick} />}
        {refine && <ViewportCapture />}
        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[48, 48]}>
          <GizmoViewport axisColors={[...axisColors]} labelColor={t.ink} />
        </GizmoHelper>
        <CameraFitter bounds={mesh?.bounds ?? null} fitToken={fitToken} />
        <PoseApplier />
        <PoseReporter />
        {thumbnails && <ThumbnailRegistrar />}
        <ResumeOnShow paused={paused} />
      </Canvas>

      {empty && <EmptyModelCard />}

      <div className="absolute top-3 left-3 flex flex-col items-start gap-2">
        {stale ? (
          <span className="pc-status is-warn">
            <IconWarning className="pc-i" aria-hidden="true" />
            {staleText(staleLabel)}
          </span>
        ) : previewing ? (
          <span className="pc-status is-busy">
            <IconSpinner className="pc-i" aria-hidden="true" />
            Quick preview · full render running
          </span>
        ) : (
          mesh && <DimsReadout bounds={mesh.bounds} axes />
        )}
        {refine && <ReferencePhoto bounds={mesh?.bounds ?? null} />}
      </div>

      <div className="absolute top-3 right-3 flex gap-1">
        {refine && <PartColoursToggle available={partsReady} />}
        <button
          type="button"
          aria-label="Fit view"
          title="Fit view"
          className="grid size-(--control-sm) place-items-center rounded-sm border border-line bg-panel text-ink-muted hover:text-ink disabled:text-ink-disabled pointer-coarse:size-(--touch-target)"
          onClick={() => setFitToken((n) => n + 1)}
          disabled={!mesh}
        >
          <IconFit className="pc-i" aria-hidden="true" />
        </button>
      </div>

      {pick && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2">
          <PickPopover pick={pick} vision={vision} onAskAi={() => void focusComposer()} onShowCode={goToLine} />
        </div>
      )}

      {pick ? (
        <div className="pc-caption absolute bottom-3 left-3">Tap empty space to clear · Esc</div>
      ) : legend ? (
        <div className="absolute bottom-3 left-3 max-w-[calc(100%-120px)] rounded-sm border border-line bg-panel px-2 py-1">
          <Legend entries={legend} />
        </div>
      ) : (
        mesh && (
          <div className="absolute bottom-3 left-3 flex flex-col items-start gap-2">
            <TriangleWarning count={mesh.triangleCount} />
            <div className="pc-caption pc-mono">
              {mesh.triangleCount.toLocaleString('en-US')} triangles
              {tagState === 'pending' && ' · finding parts…'}
            </div>
          </div>
        )
      )}
    </div>
  )
}
