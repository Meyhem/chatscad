import type { ContentPart, LlmProvider, Usage } from '../ai/types'
import type { PresetView } from '../export/frames'
import { PHOTO_REVIEW_NOTE } from '../photos/photoPrompt'
import { formatDims } from '../render/dims'
import type { MeshData, ParamValue, RenderRequest, RenderResult } from '../render/types'
import { formatLines, listTaggableStatements, resolveEditScope } from '../scad/statements'
import { CHECK_KIND_LABEL, cleanChecks, type Check } from './checks'
import type { ReviewFrame } from './frames'
import { askForJson } from './llm'
import { partColourName, partToken } from './partColours'

export const REVIEW_SYSTEM = `You review 3D-printable parts written in OpenSCAD. Units are millimetres. Z is up.

Judge the rendered model against each numbered check.
- Use the images for shape, presence and placement of parts. Images cannot be measured: use the code and the stated size for numbers.
- Parts are coloured only to label them; the colours are not part of the design. The legend names each part's module and lines.
- Mark a check "pass" only when the evidence supports it, "fail" when it does not, "unclear" when you cannot tell. Give short evidence, naming the view or the code.
- Every failed check needs an issue that would fix it. Add issues outside the checks only for clear defects (floating parts, missing geometry, parts that should touch but do not), with severity "low".
- An issue's part is the module name from the legend, or the new module name for a part that does not exist yet. The change is one concrete instruction for the code.
- If the latest request asks for something no check covers, suggest it as a new check.

Reply with JSON only:
{"summary": "one sentence", "checks": [{"n": 1, "status": "pass|fail|unclear", "evidence": "..."}], "issues": [{"severity": "high|medium|low", "part": "module_name or null", "check": 2, "change": "..."}], "newChecks": [{"kind": "part|size|fit|feature|print|other", "text": "..."}]}`

export interface LegendEntry {
  tag: number
  label: string
  /** "line 14", "lines 16–19"; empty for untagged faces. */
  lines: string
  colour: string
  token: string
}

export interface ReviewFacts {
  dims: string
  triangles: number
  warnings: string[]
}

export type CheckStatus = 'pass' | 'fail' | 'unclear'
export type Severity = 'high' | 'medium' | 'low'

export interface CheckVerdict {
  checkId: string
  status: CheckStatus
  evidence: string
}

export interface Issue {
  id: string
  severity: Severity
  /** Module name of an existing or a new part; null when the issue is about the whole model. */
  part: string | null
  checkId: string | null
  change: string
}

export interface Review {
  summary: string
  verdicts: CheckVerdict[]
  issues: Issue[]
  newChecks: Check[]
}

const UNTAGGED_LABEL = 'Not matched to a part'

/** Legend entries for the tags present in `faceTags`, in tag order, then grey for untagged faces. */
export function buildLegend(code: string, faceTags: Uint32Array): LegendEntry[] {
  const present = new Set(faceTags)
  const entries: LegendEntry[] = listTaggableStatements(code)
    .filter((s) => present.has(s.tag))
    .map((s) => ({ tag: s.tag, label: s.label, lines: formatLines(resolveEditScope(code, s)), colour: partColourName(s.tag), token: partToken(s.tag) }))
  if (present.has(0)) entries.push({ tag: 0, label: UNTAGGED_LABEL, lines: '', colour: partColourName(0), token: partToken(0) })
  return entries
}

const VIEW_LABEL: Record<PresetView, string> = {
  iso: 'iso',
  front: 'front (looking along +Y)',
  top: 'top (looking down, Y up)',
  right: 'right (looking along -X)',
}

export function buildReviewContent(input: {
  request: string
  latest: string
  checks: Check[]
  code: string
  facts: ReviewFacts
  legend: LegendEntry[]
  images: Array<{ view: PresetView; data: string }>
}): ContentPart[] {
  const lines: string[] = [`Original request: ${input.request}`]
  if (input.latest.trim() !== input.request.trim()) lines.push(`Latest request: ${input.latest}`)
  lines.push('', 'Checks:', ...input.checks.map((c, i) => `${i + 1}. [${CHECK_KIND_LABEL[c.kind]}] ${c.text}`), '')
  if (input.legend.length > 0) {
    lines.push(
      'Legend of part colours:',
      ...input.legend.map((l) => (l.tag === 0 ? `- ${l.colour}: faces not matched to a part` : `- ${l.colour}: ${l.label} (${l.lines})`)),
    )
    if (input.legend.filter((l) => l.tag > 0).length > 7) lines.push('More than seven parts: colours repeat, so use the code to tell parts of the same colour apart.')
  } else {
    lines.push('The parts could not be coloured; the model is shown in one colour.')
  }
  lines.push('', `Size: ${input.facts.dims}. Triangles: ${input.facts.triangles.toLocaleString('en-US')}.`)
  lines.push(input.facts.warnings.length > 0 ? `Compiler warnings:\n${input.facts.warnings.map((w) => `- ${w}`).join('\n')}` : 'Compiler warnings: none.')
  lines.push('', 'main.scad:', '```openscad', input.code.replace(/\n$/, ''), '```')
  return [
    { type: 'text', text: lines.join('\n') },
    ...input.images.flatMap((image): ContentPart[] => [
      { type: 'text', text: `View: ${VIEW_LABEL[image.view]}` },
      { type: 'image', mediaType: 'image/png', data: image.data },
    ]),
  ]
}

const STATUSES: readonly CheckStatus[] = ['pass', 'fail', 'unclear']
const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low']
const MAX_ISSUES = 8
const MAX_TEXT = 300
const MAX_NEW_CHECKS = 3

const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)) : []

/** A module-safe part name, or null. */
function partName(v: unknown): string | null {
  const name = text(v, 60).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return name === '' || name === 'null' ? null : /^[a-z_]/.test(name) ? name.slice(0, 40) : null
}

export function parseReview(value: Record<string, unknown>, checks: Check[]): Review {
  const byNumber = new Map<number, CheckVerdict>()
  for (const v of list(value.checks)) {
    const n = typeof v.n === 'number' ? v.n : Number(v.n)
    if (!Number.isInteger(n) || n < 1 || n > checks.length || byNumber.has(n)) continue
    const status = text(v.status, 20).toLowerCase()
    byNumber.set(n, {
      checkId: checks[n - 1].id,
      status: (STATUSES as readonly string[]).includes(status) ? (status as CheckStatus) : 'unclear',
      evidence: text(v.evidence),
    })
  }
  if (byNumber.size === 0) throw new Error('The review had no verdicts')
  const verdicts = checks.map((c, i) => byNumber.get(i + 1) ?? { checkId: c.id, status: 'unclear' as const, evidence: 'The reviewer did not judge this check.' })

  const issues: Issue[] = []
  for (const raw of list(value.issues)) {
    if (issues.length >= MAX_ISSUES) break
    const change = text(raw.change)
    if (change === '') continue
    const severity = text(raw.severity, 20).toLowerCase()
    const n = typeof raw.check === 'number' ? raw.check : Number(raw.check)
    issues.push({
      id: crypto.randomUUID(),
      severity: (SEVERITIES as readonly string[]).includes(severity) ? (severity as Severity) : 'medium',
      part: partName(raw.part),
      checkId: Number.isInteger(n) && n >= 1 && n <= checks.length ? checks[n - 1].id : null,
      change,
    })
  }
  return { summary: text(value.summary), verdicts, issues, newChecks: cleanChecks(value.newChecks).slice(0, MAX_NEW_CHECKS) }
}

export interface ReviewDeps {
  /** A tagged preview render on the background queue, so the editor and viewer are untouched. */
  renderTagged(req: RenderRequest, signal?: AbortSignal): Promise<RenderResult>
  frames(mesh: MeshData, faceTags: Uint32Array | null): Promise<ReviewFrame[]>
  toBase64(blob: Blob): Promise<string>
}

export interface ReviewOutcome {
  review: Review
  frames: ReviewFrame[]
  legend: LegendEntry[]
  coloured: boolean
  facts: ReviewFacts
  usage: Usage
}

const MAX_WARNINGS = 10

/** Colours the parts, renders the four views, and asks the reviewer model to judge them against the checks. */
export async function runReview(
  opts: {
    provider: LlmProvider
    model: string
    request: string
    latest: string
    checks: Check[]
    code: string
    params: Record<string, ParamValue>
    libraries: string[]
    /** The successful untagged render of `code` the review is about. */
    base: Extract<RenderResult, { ok: true }>
    /** Spec P6: the project's reference photos, sent after the rendered views. */
    photos?: ContentPart[]
    signal?: AbortSignal
  },
  deps: ReviewDeps,
): Promise<ReviewOutcome> {
  const statements = listTaggableStatements(opts.code)
  let mesh = opts.base.mesh
  let faceTags: Uint32Array | null = null
  if (statements.length === 1) {
    faceTags = new Uint32Array(mesh.triangleCount).fill(statements[0].tag)
  } else if (statements.length > 1) {
    const tagged = await deps.renderTagged(
      { code: opts.code, params: opts.params, libraries: opts.libraries, preview: { tagged: true } },
      opts.signal,
    )
    if (tagged.ok && tagged.mesh.faceTags) {
      mesh = tagged.mesh
      faceTags = tagged.mesh.faceTags
    }
  }
  opts.signal?.throwIfAborted()

  const legend = faceTags ? buildLegend(opts.code, faceTags) : []
  const frames = await deps.frames(mesh, faceTags)
  opts.signal?.throwIfAborted()
  const images = await Promise.all(frames.map(async (f) => ({ view: f.view, data: await deps.toBase64(f.png) })))
  const facts: ReviewFacts = {
    dims: formatDims(opts.base.mesh.bounds),
    triangles: opts.base.mesh.triangleCount,
    warnings: opts.base.diagnostics.filter((d) => d.severity === 'warning').map((d) => `line ${d.line}: ${d.message}`).slice(0, MAX_WARNINGS),
  }
  const { value, usage } = await askForJson({
    provider: opts.provider,
    model: opts.model,
    system: REVIEW_SYSTEM,
    content: [
      ...buildReviewContent({ request: opts.request, latest: opts.latest, checks: opts.checks, code: opts.code, facts, legend, images }),
      ...(opts.photos && opts.photos.length > 0 ? [{ type: 'text' as const, text: PHOTO_REVIEW_NOTE }, ...opts.photos] : []),
    ],
    parse: (v) => parseReview(v, opts.checks),
    signal: opts.signal,
  })
  return { review: value, frames, legend, coloured: faceTags !== null, facts, usage }
}
