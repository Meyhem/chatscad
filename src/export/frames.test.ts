import type { Mock } from 'vitest'
import type { Bounds, MeshData, Vec3 } from '../render/types'
import { okResult } from '../test/results'
import { computeCameraFit } from '../viewer/cameraFit'
import { FRAME_FOV, orthoPose, presetPose, renderFrames, turntablePoses, type CameraPose } from './frames'

interface RendererOpts {
  width: number
  height: number
  background: string | null
  filament: string
  edges?: string
}
interface FakeRenderer {
  opts: RendererOpts
  setMesh: Mock<(mesh: MeshData, colours?: Float32Array) => void>
  render: Mock<(pose: CameraPose) => ImageData>
  dispose: Mock<() => void>
}

const { renderers } = vi.hoisted(() => ({ renderers: [] as FakeRenderer[] }))

vi.mock('./glFrameRenderer', () => ({
  createGlFrameRenderer: (opts: RendererOpts) => {
    const r: FakeRenderer = {
      opts,
      setMesh: vi.fn<(mesh: MeshData, colours?: Float32Array) => void>(),
      render: vi.fn(
        (_pose: CameraPose) => ({ width: opts.width, height: opts.height, data: new Uint8ClampedArray(4) }) as unknown as ImageData,
      ),
      dispose: vi.fn<() => void>(),
    }
    renderers.push(r)
    return r
  },
}))
vi.mock('../theme/tokens', () => ({ readToken: (name: string) => `token:${name}` }))

const result = okResult()
if (!result.ok) throw new Error('fixture must succeed')
const mesh = result.mesh
const dist = (p: Vec3, t: Vec3) => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])

beforeEach(() => {
  renderers.length = 0
})

it('uses the viewer auto-fit as the iso pose', () => {
  const fit = computeCameraFit(mesh.bounds, FRAME_FOV, 1)
  expect(presetPose(mesh.bounds, 'iso')).toEqual({ position: fit.position, target: fit.target })
})

it('looks along +Y for front and straight down with Y up for top', () => {
  const front = presetPose(mesh.bounds, 'front')
  const t = front.target
  expect(front.position[0]).toBeCloseTo(t[0])
  expect(front.position[2]).toBeCloseTo(t[2])
  expect(front.position[1]).toBeLessThan(t[1])

  const top = presetPose(mesh.bounds, 'top')
  expect(top.position[0]).toBeCloseTo(t[0])
  expect(top.position[1]).toBeCloseTo(t[1])
  expect(top.position[2]).toBeGreaterThan(t[2])
  expect(top.up).toEqual([0, 1, 0])
})

it('looks along -X from the right, with Z up', () => {
  const right = presetPose(mesh.bounds, 'right')
  const t = right.target
  expect(right.position[1]).toBeCloseTo(t[1])
  expect(right.position[2]).toBeCloseTo(t[2])
  expect(right.position[0]).toBeGreaterThan(t[0])
  expect(right.up).toBeUndefined()
})

it('passes per-vertex part colours to the renderer when given', async () => {
  const colours = new Float32Array(mesh.triangleCount * 9)
  for await (const _ of renderFrames({ mesh, size: [8, 8], background: null, cameras: [presetPose(mesh.bounds, 'iso')], colours })) break
  expect(renderers[0].setMesh).toHaveBeenCalledExactlyOnceWith(mesh, colours)
})

it('circles the model once at a constant height and distance, starting at the iso pose', () => {
  const iso = presetPose(mesh.bounds, 'iso')
  const poses = turntablePoses(mesh.bounds, 36)
  expect(poses).toHaveLength(36)
  poses[0].position.forEach((c, i) => expect(c).toBeCloseTo(iso.position[i]))
  for (const p of poses) {
    expect(p.position[2]).toBeCloseTo(iso.position[2])
    expect(dist(p.position, p.target)).toBeCloseTo(dist(iso.position, iso.target))
  }
  const dx = iso.position[0] - iso.target[0]
  const dy = iso.position[1] - iso.target[1]
  const quarter = poses[9].position
  expect(quarter[0] - iso.target[0]).toBeCloseTo(-dy)
  expect(quarter[1] - iso.target[1]).toBeCloseTo(dx)
})

it('renders one frame per pose with the current filament token, then disposes the renderer', async () => {
  const cameras = turntablePoses(mesh.bounds, 3)
  const frames: ImageData[] = []
  for await (const frame of renderFrames({ mesh, size: [64, 48], background: null, cameras })) frames.push(frame)

  expect(frames).toHaveLength(3)
  expect(renderers).toHaveLength(1)
  expect(renderers[0].opts).toEqual({ width: 64, height: 48, background: null, filament: 'token:filament' })
  expect(renderers[0].setMesh).toHaveBeenCalledExactlyOnceWith(mesh)
  expect(renderers[0].render.mock.calls.map(([pose]) => pose)).toEqual(cameras)
  expect(renderers[0].dispose).toHaveBeenCalledTimes(1)
})

it('disposes the renderer when the consumer stops early', async () => {
  const frames = renderFrames({ mesh, size: [8, 8], background: 'token:viewport', cameras: turntablePoses(mesh.bounds, 5) })
  await frames.next()
  await frames.return(undefined)
  expect(renderers[0].render).toHaveBeenCalledTimes(1)
  expect(renderers[0].dispose).toHaveBeenCalledTimes(1)
})

const OFFSET: Bounds = { min: [-10, 5, 0], max: [30, 25, 10] }

it('places orthographic cameras on the axes, looking at the centre of the model', () => {
  const front = orthoPose(OFFSET, 'front', 12)
  expect(front.target).toEqual([10, 15, 5])
  expect(front.position[0]).toBe(10)
  expect(front.position[1]).toBeLessThan(5)
  expect(front.position[2]).toBe(5)
  expect(front.up).toBeUndefined()
  expect(front.ortho).toEqual({ halfHeight: 12 })

  const top = orthoPose(OFFSET, 'top', 12)
  expect(top.position.slice(0, 2)).toEqual([10, 15])
  expect(top.position[2]).toBeGreaterThan(10)
  expect(top.up).toEqual([0, 1, 0])

  const right = orthoPose(OFFSET, 'right', 12)
  expect(right.position[0]).toBeGreaterThan(30)
  expect(right.position.slice(1)).toEqual([15, 5])
})

it('keeps the camera clear of a model that is flat or tiny', () => {
  const flat: Bounds = { min: [0, 0, 0], max: [0, 0, 0] }
  const pose = orthoPose(flat, 'front', 1)
  expect(pose.position[1]).toBeLessThan(0)
  expect(Number.isFinite(pose.position[1])).toBe(true)
})

it('hands orthographic poses to the renderer unchanged', async () => {
  const pose = orthoPose(mesh.bounds, 'top', 7)
  for await (const _ of renderFrames({ mesh, size: [64, 32], background: null, cameras: [pose] })) {
    // drain
  }
  expect(renderers.at(-1)!.render).toHaveBeenCalledWith(pose)
})

it('asks the renderer for feature edges in the given colour', async () => {
  for await (const _ of renderFrames({ mesh, size: [8, 8], background: null, cameras: [orthoPose(mesh.bounds, 'top', 5)], edges: 'ink' })) break
  expect(renderers.at(-1)!.opts.edges).toBe('ink')
})
