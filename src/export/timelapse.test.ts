import type { Version } from '../db/db'
import { parseStl } from '../render/stl'
import type { RenderRequest, RenderResult } from '../render/types'
import { errorResult } from '../test/results'
import { binaryStl } from '../test/stl'
import { version } from '../test/versions'
import { presetPose, turntablePoses, type CameraPose } from './frames'
import {
  captionFor,
  describePlan,
  formatTimelapseProgress,
  parseSeconds,
  planTimelapse,
  renderTimelapse,
  sampleEvenly,
  unionBounds,
  type TimelapseDeps,
  type TimelapseProgress,
} from './timelapse'

vi.mock('../theme/tokens', () => ({ readToken: (name: string) => `token:${name}` }))

const v1 = version({ id: 'a', label: 'v1', createdAt: 1, message: 'A wall hook for a 30 mm broom handle' })
const v2 = version({ id: 'b', parentId: 'a', label: 'v2', createdAt: 2 })
const v21 = version({ id: 'e', parentId: 'a', label: 'v2.1', kind: 'variant', variantGroupId: 'g', createdAt: 2.5 })
const v3 = version({ id: 'c', parentId: 'b', label: 'v3', createdAt: 3, compileStatus: 'error' })
const v4 = version({ id: 'd', parentId: 'c', label: 'v4', createdAt: 5 })
const elsewhere = version({ id: 'f', parentId: 'zz', label: 'v9', kind: 'variant', createdAt: 4 })
const ancestry = [v4, v3, v2, v1]
const all = [v1, v2, v21, v3, v4, elsewhere]
const labels = (vs: Version[]) => vs.map((v) => v.label)

describe('planTimelapse', () => {
  it('walks the branch oldest first, skipping failed versions and unpicked variants by default', () => {
    const plan = planTimelapse(ancestry, all, { includeFailed: false, includeVariants: false })
    expect(labels(plan.versions)).toEqual(['v1', 'v2', 'v4'])
    expect(labels(plan.skippedFailed)).toEqual(['v3'])
    expect(labels(plan.skippedVariants)).toEqual(['v2.1'])
    expect(describePlan(plan)).toBe('v1 → v4 along the current branch. The failed v3 and 1 unpicked variant are skipped.')
  })

  it('includes failed versions or variants when asked, in creation order', () => {
    const failed = planTimelapse(ancestry, all, { includeFailed: true, includeVariants: false })
    expect(labels(failed.versions)).toEqual(['v1', 'v2', 'v3', 'v4'])
    expect(describePlan(failed)).toBe('v1 → v4 along the current branch. 1 unpicked variant is skipped.')

    const variants = planTimelapse(ancestry, all, { includeFailed: false, includeVariants: true })
    expect(labels(variants.versions)).toEqual(['v1', 'v2', 'v2.1', 'v4'])
    expect(describePlan(variants)).toBe('v1 → v4 along the current branch. The failed v3 is skipped.')
  })

  it('samples long histories evenly to 40 frames, keeping the first and the last', () => {
    const long = Array.from({ length: 63 }, (_, i) => version({ label: `v${i + 1}`, createdAt: 100 + i })).reverse()
    const plan = planTimelapse(long, long, { includeFailed: false, includeVariants: false })
    expect(plan.versions).toHaveLength(40)
    expect(plan.versions[0].label).toBe('v1')
    expect(plan.versions[39].label).toBe('v63')
    expect(plan.sampledFrom).toBe(63)
    expect(describePlan(plan)).toBe('v1 → v63 along the current branch. Showing 40 of 63 versions, evenly spaced.')
  })

  it('describes a branch with one or no usable versions', () => {
    expect(describePlan(planTimelapse([v1], [v1], { includeFailed: false, includeVariants: false }))).toBe('Only v1 so far.')
    expect(describePlan(planTimelapse([v3], [v3], { includeFailed: false, includeVariants: false }))).toBe(
      'Nothing on this branch compiled yet. The failed v3 is skipped.',
    )
  })
})

it('samples evenly', () => {
  expect(sampleEvenly([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5])
  expect(sampleEvenly([1, 2], 3)).toEqual([1, 2])
})

it('captions a frame with the version and a shortened prompt', () => {
  expect(captionFor(v1)).toBe('v1 · “A wall hook for a 30 mm broom handle”')
  expect(captionFor(version({ label: 'v7', message: '  ' }))).toBe('v7')
  const long = captionFor(version({ label: 'v8', message: 'x'.repeat(100) }))
  expect(long).toBe(`v8 · “${'x'.repeat(71)}…”`)
})

it('reads seconds leniently within limits', () => {
  const limits = { min: 0.05, max: 10, fallback: 0.8 }
  expect(parseSeconds('0.8', limits)).toBe(0.8)
  expect(parseSeconds(' 1,5 ', limits)).toBe(1.5)
  expect(parseSeconds('abc', limits)).toBe(0.8)
  expect(parseSeconds('20', limits)).toBe(10)
  expect(parseSeconds('0', limits)).toBe(0.05)
})

it('formats both phases of progress', () => {
  expect(formatTimelapseProgress({ phase: 'compile', done: 2, total: 6, label: 'v3' })).toBe('Compiling v3 · 3 of 6')
  expect(formatTimelapseProgress({ phase: 'frames', done: 4, total: 6, bytes: 1_066_667 })).toBe(
    'Rendering frames · 4 of 6 · about 1.6 MB',
  )
})

describe('renderTimelapse', () => {
  function meshResult(width: number): RenderResult {
    const stl = binaryStl([
      [
        [0, 0, 0],
        [width, 10, 0],
        [0, 0, 10],
      ],
    ])
    return { ok: true, mesh: parseStl(stl), stl, logs: [], diagnostics: [], renderMs: 5 }
  }

  function fakes(results: Record<string, RenderResult>) {
    const delays: number[] = []
    const cameras: CameraPose[] = []
    const captions: string[] = []
    const encoder = {
      addFrame: vi.fn(async (_f: ImageData, delay: number) => {
        delays.push(delay)
        return delays.length * 500
      }),
      finish: vi.fn(async () => new Blob(['GIF89a'], { type: 'image/gif' })),
      terminate: vi.fn(),
    }
    const queue = { render: vi.fn(async (req: RenderRequest) => results[req.code]) }
    const deps = {
      queue,
      createEncoder: vi.fn(async () => encoder),
      renderFrames: vi.fn(async function* (opts: { cameras: CameraPose[]; size: [number, number] }) {
        cameras.push(...opts.cameras)
        yield { width: opts.size[0], height: opts.size[1], data: new Uint8ClampedArray(4) } as unknown as ImageData
      }),
      drawCaption: vi.fn((frame: ImageData, text: string, _colors: { ink: string; panel: string }) => {
        captions.push(text)
        return frame
      }),
    }
    return { delays, cameras, captions, encoder, queue, deps: deps as unknown as TimelapseDeps, raw: deps }
  }

  const base = {
    size: [640, 480] as [number, number],
    frameDelayMs: 800,
    holdMs: 2_000,
    caption: true,
    turntable: false,
    signal: new AbortController().signal,
    onProgress: () => {},
  }

  it('compiles every version with the project libraries', async () => {
    const f = fakes({ A: meshResult(10) })
    await renderTimelapse({ ...base, versions: [version({ label: 'v1', code: 'A' })], libraries: ['MCAD'] }, f.deps)
    expect(f.queue.render.mock.calls[0][0]).toMatchObject({ code: 'A', libraries: ['MCAD'] })
  })

  it('compiles each version in the queue, fixes the camera to the union of all models, and holds the last frame', async () => {
    const a = version({ label: 'v1', code: 'A', params: { w: 1 }, message: 'first' })
    const b = version({ label: 'v2', code: 'B' })
    const f = fakes({ A: meshResult(10), B: meshResult(40) })
    const progress: TimelapseProgress[] = []
    const out = await renderTimelapse({ ...base, versions: [a, b], onProgress: (p) => progress.push(p) }, f.deps)

    expect(f.queue.render.mock.calls.map(([req]) => req)).toEqual([{ code: 'A', params: { w: 1 } }, { code: 'B', params: {} }])
    const okA = meshResult(10)
    const okB = meshResult(40)
    if (!okA.ok || !okB.ok) throw new Error('fixture must succeed')
    const fixed = presetPose(unionBounds([okA.mesh.bounds, okB.mesh.bounds]), 'iso')
    expect(f.cameras).toEqual([fixed, fixed])
    expect(f.delays).toEqual([800, 2_800])
    expect(f.captions).toEqual(['v1 · “first”', 'v2'])
    expect(f.raw.drawCaption.mock.calls[0][2]).toEqual({ ink: 'token:ink', panel: 'token:panel' })
    expect(out).toMatchObject({ frames: 2, failed: [] })
    expect(progress[0]).toEqual({ phase: 'compile', done: 0, total: 2, label: 'v1' })
    expect(progress.at(-1)).toEqual({ phase: 'frames', done: 2, total: 2, bytes: 1_000 })
    expect(f.encoder.terminate).toHaveBeenCalled()
  })

  it('turns slowly through half a revolution when asked', async () => {
    const vs = [version({ code: 'A' }), version({ code: 'A' }), version({ code: 'A' })]
    const f = fakes({ A: meshResult(10) })
    await renderTimelapse({ ...base, versions: vs, turntable: true, caption: false }, f.deps)
    const okA = meshResult(10)
    if (!okA.ok) throw new Error('fixture must succeed')
    expect(f.cameras).toEqual(turntablePoses(okA.mesh.bounds, 6).slice(0, 3))
    expect(f.captions).toEqual([])
  })

  it('holds the previous model for an included failed version and reports versions that no longer compile', async () => {
    const ok = version({ label: 'v1', code: 'A' })
    const failed = version({ label: 'v2', code: 'BROKEN', compileStatus: 'error' })
    const regressed = version({ label: 'v3', code: 'GONE' })
    const f = fakes({ A: meshResult(10), BROKEN: errorResult(), GONE: errorResult() })
    const out = await renderTimelapse({ ...base, versions: [ok, failed, regressed] }, f.deps)
    expect(f.captions).toEqual(['v1', 'v2 · failed to compile'])
    expect(out).toMatchObject({ frames: 2, failed: ['v3'] })
  })

  it('fails in plain words when nothing compiles', async () => {
    const f = fakes({ X: errorResult() })
    await expect(renderTimelapse({ ...base, versions: [version({ code: 'X' })] }, f.deps)).rejects.toThrow(
      'None of the versions on this branch compiled, so there is nothing to animate',
    )
  })
})
