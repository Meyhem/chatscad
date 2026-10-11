import type { Version } from '../db/db'
import type { RenderQueue } from '../render/queue'
import type { Bounds, MeshData } from '../render/types'
import { readToken } from '../theme/tokens'
import { drawCaption } from './caption'
import { presetPose, turntablePoses } from './frames'
import { formatGifProgress, type FrameDeps, type GifProgress } from './turntable'

export const MAX_TIMELAPSE_FRAMES = 40

export interface TimelapseFilter {
  includeFailed: boolean
  includeVariants: boolean
}

export interface TimelapsePlan {
  versions: Version[]
  skippedFailed: Version[]
  skippedVariants: Version[]
  /** How many versions qualified before even sampling, when there were more than the frame limit. */
  sampledFrom: number | null
}

export function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  if (max <= 1) return items.slice(-1)
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))])
}

/** The versions along the head's ancestry (oldest first), plus unpicked variants that branch off it. */
export function planTimelapse(
  ancestryHeadFirst: Version[],
  all: Version[],
  filter: TimelapseFilter,
  max = MAX_TIMELAPSE_FRAMES,
): TimelapsePlan {
  const onBranch = new Set(ancestryHeadFirst.map((v) => v.id))
  const offshoots = all.filter((v) => v.kind === 'variant' && !onBranch.has(v.id) && v.parentId !== null && onBranch.has(v.parentId))
  const candidates = [...ancestryHeadFirst, ...offshoots].sort((a, b) => a.createdAt - b.createdAt)
  const kept: Version[] = []
  const skippedFailed: Version[] = []
  const skippedVariants: Version[] = []
  for (const v of candidates) {
    if (v.kind === 'variant' && !filter.includeVariants) skippedVariants.push(v)
    else if (v.compileStatus === 'error' && !filter.includeFailed) skippedFailed.push(v)
    else kept.push(v)
  }
  return { versions: sampleEvenly(kept, max), skippedFailed, skippedVariants, sampledFrom: kept.length > max ? kept.length : null }
}

/** "v1 → v6 along the current branch. The failed v4 and 2 unpicked variants are skipped." */
export function describePlan(plan: TimelapsePlan): string {
  const { versions, skippedFailed, skippedVariants } = plan
  const first = versions[0]?.label
  const last = versions[versions.length - 1]?.label
  let text = !first ? 'Nothing on this branch compiled yet.' : first === last ? `Only ${first} so far.` : `${first} → ${last} along the current branch.`

  const parts: string[] = []
  if (skippedFailed.length === 1) parts.push(`The failed ${skippedFailed[0].label}`)
  else if (skippedFailed.length > 1) parts.push(`${skippedFailed.length} failed versions`)
  const variants = skippedVariants.length
  if (variants > 0) parts.push(`${variants} unpicked variant${variants === 1 ? '' : 's'}`)
  if (parts.length > 0) {
    const sentence = parts.join(' and ')
    text += ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} ${skippedFailed.length + variants === 1 ? 'is' : 'are'} skipped.`
  }
  if (plan.sampledFrom !== null) text += ` Showing ${versions.length} of ${plan.sampledFrom} versions, evenly spaced.`
  return text
}

const CAPTION_PROMPT_CHARS = 72

export function captionFor(v: Version): string {
  const message = v.message.replace(/\s+/g, ' ').trim()
  if (!message) return v.label
  const short = message.length > CAPTION_PROMPT_CHARS ? `${message.slice(0, CAPTION_PROMPT_CHARS - 1).trimEnd()}…` : message
  return `${v.label} · “${short}”`
}

export function unionBounds(bounds: Bounds[]): Bounds {
  return {
    min: [0, 1, 2].map((i) => Math.min(...bounds.map((b) => b.min[i]))) as Bounds['min'],
    max: [0, 1, 2].map((i) => Math.max(...bounds.map((b) => b.max[i]))) as Bounds['max'],
  }
}

/** Seconds typed by a person: accepts "1,5", clamps to the limits, falls back when unreadable. */
export function parseSeconds(text: string, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const n = Number(text.trim().replace(',', '.'))
  if (!Number.isFinite(n) || text.trim() === '') return fallback
  return Math.min(max, Math.max(min, n))
}

export type TimelapseProgress =
  | { phase: 'compile'; done: number; total: number; label: string }
  | ({ phase: 'frames' } & GifProgress)

export function formatTimelapseProgress(p: TimelapseProgress): string {
  return p.phase === 'compile' ? `Compiling ${p.label} · ${p.done + 1} of ${p.total}` : formatGifProgress(p)
}

export interface TimelapseDeps extends FrameDeps {
  queue: Pick<RenderQueue, 'render'>
  drawCaption: typeof drawCaption
}

export async function renderTimelapse(
  opts: {
    versions: Version[]
    size: [number, number]
    frameDelayMs: number
    holdMs: number
    caption: boolean
    turntable: boolean
    signal: AbortSignal
    onProgress(p: TimelapseProgress): void
    onFrame?(frame: ImageData, index: number): void
  },
  deps: TimelapseDeps,
): Promise<{ blob: Blob; frames: number; failed: string[] }> {
  const { versions, signal } = opts
  const shots: Array<{ version: Version; mesh: MeshData; failed: boolean }> = []
  const failed: string[] = []
  let previous: MeshData | null = null

  for (const [i, version] of versions.entries()) {
    signal.throwIfAborted()
    opts.onProgress({ phase: 'compile', done: i, total: versions.length, label: version.label })
    const result = await deps.queue.render({ code: version.code, params: version.params }, signal)
    if (result.ok) {
      previous = result.mesh
      shots.push({ version, mesh: result.mesh, failed: false })
    } else if (version.compileStatus === 'error' && previous) {
      shots.push({ version, mesh: previous, failed: true })
    } else {
      failed.push(version.label)
    }
  }
  if (shots.length === 0) throw new Error('None of the versions on this branch compiled, so there is nothing to animate')

  const bounds = unionBounds(shots.map((s) => s.mesh.bounds))
  const poses = opts.turntable
    ? turntablePoses(bounds, shots.length * 2).slice(0, shots.length)
    : shots.map(() => presetPose(bounds, 'iso'))
  const background = readToken('viewport')
  const captionColors = { ink: readToken('ink'), panel: readToken('panel') }
  const [width, height] = opts.size
  const encoder = await deps.createEncoder(width, height, false)
  try {
    opts.onProgress({ phase: 'frames', done: 0, total: shots.length, bytes: 0 })
    for (const [i, shot] of shots.entries()) {
      signal.throwIfAborted()
      for await (let frame of deps.renderFrames({ mesh: shot.mesh, size: opts.size, background, cameras: [poses[i]] })) {
        if (opts.caption) {
          const text = shot.failed ? `${shot.version.label} · failed to compile` : captionFor(shot.version)
          frame = deps.drawCaption(frame, text, captionColors)
        }
        opts.onFrame?.(frame, i)
        const delay = opts.frameDelayMs + (i === shots.length - 1 ? opts.holdMs : 0)
        const bytes = await encoder.addFrame(frame, delay)
        opts.onProgress({ phase: 'frames', done: i + 1, total: shots.length, bytes })
      }
    }
    signal.throwIfAborted()
    return { blob: await encoder.finish(), frames: shots.length, failed }
  } finally {
    encoder.terminate()
  }
}
