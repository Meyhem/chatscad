import type { Mock } from 'vitest'
import type { MeshData, Vec3 } from '../render/types'
import { okResult } from '../test/results'
import { computeCameraFit } from '../viewer/cameraFit'
import { FRAME_FOV, presetPose, renderFrames, turntablePoses, type CameraPose } from './frames'

interface RendererOpts {
  width: number
  height: number
  background: string | null
  filament: string
}
interface FakeRenderer {
  opts: RendererOpts
  setMesh: Mock<(mesh: MeshData) => void>
  render: Mock<(pose: CameraPose) => ImageData>
  dispose: Mock<() => void>
}

const { renderers } = vi.hoisted(() => ({ renderers: [] as FakeRenderer[] }))

vi.mock('./glFrameRenderer', () => ({
  createGlFrameRenderer: (opts: RendererOpts) => {
    const r: FakeRenderer = {
      opts,
      setMesh: vi.fn<(mesh: MeshData) => void>(),
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
