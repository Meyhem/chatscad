import type { ContentPart, LlmProvider, Usage } from '../ai/types'
import { PHOTO_PLAN_NOTE } from '../photos/photoPrompt'
import { cleanChecks, MAX_CHECKS, type Check } from './checks'
import { askForJson } from './llm'

export const PLAN_SYSTEM = `You plan 3D-printable parts that another model will write in OpenSCAD. Units are millimetres.

Turn the request into the checks a reviewer will use to judge the finished model from four rendered views, its size and its code.
- 3 to 8 checks. Each is one short sentence that can be checked: a part that must exist, a size, how parts fit, a feature, or how it prints.
- Use only what the request says or clearly implies. Do not invent features.
- Also name the parts as OpenSCAD module names in snake_case, one per logical part.

Reply with JSON only:
{"checks": [{"kind": "part|size|fit|feature|print|other", "text": "..."}], "parts": ["body", "lid"]}`

export interface Plan {
  checks: Check[]
  parts: string[]
}

const PART = /^[a-z_][a-z0-9_]{0,39}$/
const MAX_PARTS = 12

export function parsePlan(value: unknown): Plan {
  const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const checks = cleanChecks(o.checks).slice(0, MAX_CHECKS)
  if (checks.length === 0) throw new Error('The plan had no checks')
  const raw = Array.isArray(o.parts) ? o.parts : []
  const parts = raw.filter((p): p is string => typeof p === 'string' && PART.test(p)).filter((p, i, all) => all.indexOf(p) === i).slice(0, MAX_PARTS)
  return { checks, parts }
}

export async function runPlan(opts: {
  provider: LlmProvider
  model: string
  request: string
  /** Spec P6: the project's reference photos, sent after the request. */
  photos?: ContentPart[]
  signal?: AbortSignal
}): Promise<Plan & { usage: Usage }> {
  const request = `Request: ${opts.request}`
  const content: string | ContentPart[] =
    opts.photos && opts.photos.length > 0 ? [{ type: 'text', text: `${PHOTO_PLAN_NOTE}\n\n${request}` }, ...opts.photos] : request
  const { value, usage } = await askForJson({
    provider: opts.provider,
    model: opts.model,
    system: PLAN_SYSTEM,
    content,
    parse: parsePlan,
    signal: opts.signal,
  })
  return { ...value, usage }
}
