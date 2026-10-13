import type { ContentPart } from '../ai/types'
import type { RenderResult } from '../render/types'
import { okResult } from '../test/results'
import { scriptedProvider } from '../test/providers'
import type { Check } from './checks'
import { buildLegend, buildReviewContent, parseReview, REVIEW_SYSTEM, runReview, type ReviewDeps } from './review'

const CODE = ['module body() cube([40, 20, 10]);', '', 'module lid_rail()', '  translate([0, 20, 8]) cube([40, 2, 2]);', '', 'body();', 'lid_rail();', ''].join('\n')

const CHECKS: Check[] = [
  { id: 'c1', kind: 'part', text: 'A body' },
  { id: 'c2', kind: 'part', text: 'Rails on both long sides' },
  { id: 'c3', kind: 'print', text: 'Prints without supports' },
]

const result = okResult()
if (!result.ok) throw new Error('fixture must succeed')
const ok: Extract<RenderResult, { ok: true }> = result

it('names each tagged part with its colour and lines, and grey for untagged faces', () => {
  const legend = buildLegend(CODE, new Uint32Array([1, 1, 2, 0]))
  expect(legend).toEqual([
    { tag: 1, label: 'body', lines: 'line 1', colour: 'orange', token: 'part-1' },
    { tag: 2, label: 'lid_rail', lines: 'lines 3–4', colour: 'sky blue', token: 'part-2' },
    { tag: 0, label: 'Not matched to a part', lines: '', colour: 'grey', token: 'part-none' },
  ])
})

it('sends the request, numbered checks, legend, facts and code, then the four labelled views', () => {
  const content = buildReviewContent({
    request: 'A holder with a sliding lid',
    latest: 'Make the walls 3 mm',
    checks: CHECKS,
    code: CODE,
    facts: { dims: '40 × 22 × 10 mm', triangles: 24, warnings: ['Object may not be a valid 2-manifold'] },
    legend: buildLegend(CODE, new Uint32Array([1, 2])),
    images: [
      { view: 'iso', data: 'AAA' },
      { view: 'right', data: 'BBB' },
    ],
  })
  const text = (content[0] as Extract<ContentPart, { type: 'text' }>).text
  expect(text).toContain('Original request: A holder with a sliding lid')
  expect(text).toContain('Latest request: Make the walls 3 mm')
  expect(text).toContain('1. [Part] A body\n2. [Part] Rails on both long sides\n3. [Print] Prints without supports')
  expect(text).toContain('- orange: body (line 1)\n- sky blue: lid_rail (lines 3–4)')
  expect(text).toContain('Size: 40 × 22 × 10 mm. Triangles: 24.')
  expect(text).toContain('Compiler warnings:\n- Object may not be a valid 2-manifold')
  expect(text).toContain('```openscad\nmodule body()')
  expect(content.slice(1)).toEqual([
    { type: 'text', text: 'View: iso' },
    { type: 'image', mediaType: 'image/png', data: 'AAA' },
    { type: 'text', text: 'View: right (looking along -X)' },
    { type: 'image', mediaType: 'image/png', data: 'BBB' },
  ])
})

it('says when the parts could not be coloured', () => {
  const content = buildReviewContent({ request: 'A box', latest: 'A box', checks: CHECKS, code: CODE, facts: { dims: '1 × 1 × 1 mm', triangles: 12, warnings: [] }, legend: [], images: [] })
  const text = (content[0] as { text: string }).text
  expect(text).toContain('The parts could not be coloured')
  expect(text).not.toContain('Latest request')
  expect(text).toContain('Compiler warnings: none.')
})

it('reads verdicts per check, issues tied to checks and parts, and suggested checks', () => {
  const review = parseReview(
    {
      summary: 'The rail is on one side only.',
      checks: [
        { n: 1, status: 'pass', evidence: 'Orange body in every view.' },
        { n: 2, status: 'FAIL', evidence: 'Right view: one rail.' },
        { n: 9, status: 'pass', evidence: 'no such check' },
      ],
      issues: [
        { severity: 'high', part: 'lid_rail', check: 2, change: 'Mirror the rail onto the other side.' },
        { severity: 'urgent', part: 'new lid!', check: null, change: 'Add a lid.' },
        { severity: 'low', change: '' },
      ],
      newChecks: [{ kind: 'size', text: 'Walls 3 mm thick' }],
    },
    CHECKS,
  )
  expect(review.summary).toBe('The rail is on one side only.')
  expect(review.verdicts).toEqual([
    { checkId: 'c1', status: 'pass', evidence: 'Orange body in every view.' },
    { checkId: 'c2', status: 'fail', evidence: 'Right view: one rail.' },
    { checkId: 'c3', status: 'unclear', evidence: 'The reviewer did not judge this check.' },
  ])
  expect(review.issues.map(({ id: _, ...rest }) => rest)).toEqual([
    { severity: 'high', part: 'lid_rail', checkId: 'c2', change: 'Mirror the rail onto the other side.' },
    { severity: 'medium', part: 'new_lid', checkId: null, change: 'Add a lid.' },
  ])
  expect(review.newChecks.map((c) => [c.kind, c.text])).toEqual([['size', 'Walls 3 mm thick']])
})

it('refuses an answer with no verdicts', () => {
  expect(() => parseReview({ summary: 'fine' }, CHECKS)).toThrow('The review had no verdicts')
})

function fakeDeps(tagged = true): ReviewDeps & { rendered: unknown[] } {
  const rendered: unknown[] = []
  return {
    rendered,
    renderTagged: async (req) => {
      rendered.push(req)
      if (!tagged) return { ok: false, error: 'Render timed out after 60 s', logs: [], diagnostics: [], renderMs: 1 }
      return { ...ok, mesh: { ...ok.mesh, faceTags: new Uint32Array(ok.mesh.triangleCount).fill(2) } }
    },
    frames: async (_mesh, tags) => [
      { view: 'iso', png: new Blob([tags ? 'coloured' : 'plain']) },
      { view: 'front', png: new Blob(['f']) },
      { view: 'top', png: new Blob(['t']) },
      { view: 'right', png: new Blob(['r']) },
    ],
    toBase64: async (blob) => btoa(await blob.text()),
  }
}

const ANSWER = JSON.stringify({ summary: 'Good.', checks: [{ n: 1, status: 'pass', evidence: 'x' }, { n: 2, status: 'pass', evidence: 'y' }, { n: 3, status: 'pass', evidence: 'z' }], issues: [] })

it('renders the tagged parts in the background, sends four views to the reviewer and returns its verdict', async () => {
  const { provider, requests } = scriptedProvider({ text: ANSWER, usage: { inputTokens: 3000, outputTokens: 900 } })
  const deps = fakeDeps()
  const outcome = await runReview(
    { provider, model: 'seer', request: 'A holder', latest: 'A holder', checks: CHECKS, code: CODE, params: { w: 3 }, libraries: ['BOSL2'], base: ok },
    deps,
  )
  expect(deps.rendered).toEqual([{ code: CODE, params: { w: 3 }, libraries: ['BOSL2'], preview: { tagged: true } }])
  expect(outcome.coloured).toBe(true)
  expect(outcome.legend.map((l) => l.label)).toEqual(['lid_rail'])
  expect(outcome.frames).toHaveLength(4)
  expect(outcome.review.verdicts.every((v) => v.status === 'pass')).toBe(true)
  expect(outcome.usage).toEqual({ inputTokens: 3000, outputTokens: 900 })
  expect(requests[0].model).toBe('seer')
  expect(requests[0].system).toBe(REVIEW_SYSTEM)
  const images = (requests[0].messages[0].content as ContentPart[]).filter((p) => p.type === 'image')
  expect(images).toHaveLength(4)
  expect(images[0]).toMatchObject({ data: btoa('coloured') })
})

it('reviews plain frames when the tagged render fails', async () => {
  const { provider, requests } = scriptedProvider(ANSWER)
  const outcome = await runReview(
    { provider, model: 'seer', request: 'A holder', latest: 'A holder', checks: CHECKS, code: CODE, params: {}, libraries: [], base: ok },
    fakeDeps(false),
  )
  expect(outcome.coloured).toBe(false)
  expect(outcome.legend).toEqual([])
  expect((requests[0].messages[0].content as ContentPart[])[0]).toMatchObject({ text: expect.stringContaining('could not be coloured') })
})
