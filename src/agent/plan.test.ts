import { scriptedProvider } from '../test/providers'
import { parsePlan, PLAN_SYSTEM, runPlan } from './plan'

const REPLY = JSON.stringify({
  checks: [
    { kind: 'part', text: 'Body with four cell bores in one row' },
    { kind: 'size', text: 'Walls at least 2 mm thick' },
    { kind: 'Feature', text: 'A finger notch near one end of the lid' },
  ],
  parts: ['body', 'bores', 'lid_rail', 'lid', 'finger notch', 'Lid'],
})

it('reads checks and module-safe part names, dropping repeats and unsafe names', () => {
  const plan = parsePlan(JSON.parse(REPLY))
  expect(plan.checks.map((c) => [c.kind, c.text])).toEqual([
    ['part', 'Body with four cell bores in one row'],
    ['size', 'Walls at least 2 mm thick'],
    ['feature', 'A finger notch near one end of the lid'],
  ])
  expect(plan.parts).toEqual(['body', 'bores', 'lid_rail', 'lid'])
})

it('refuses a plan without checks', () => {
  expect(() => parsePlan({ checks: [] })).toThrow('The plan had no checks')
  expect(() => parsePlan('nope')).toThrow('The plan had no checks')
})

it('asks the builder model for checks with the request, and reports usage', async () => {
  const { provider, requests } = scriptedProvider({ text: `Plan:\n\`\`\`json\n${REPLY}\n\`\`\``, usage: { inputTokens: 500, outputTokens: 340 } })
  const plan = await runPlan({ provider, model: 'builder', request: 'A holder for four 18650 cells with a sliding lid' })
  expect(plan.checks).toHaveLength(3)
  expect(plan.usage).toEqual({ inputTokens: 500, outputTokens: 340 })
  expect(requests[0].model).toBe('builder')
  expect(requests[0].system).toBe(PLAN_SYSTEM)
  expect(requests[0].messages[0].content).toContain('A holder for four 18650 cells with a sliding lid')
})

it('sends the photos after the request, with the planning note', async () => {
  const { provider, requests } = scriptedProvider(REPLY)
  await runPlan({ provider, model: 'm', request: 'A bracket', photos: [{ type: 'text', text: 'Reference photo (front)' }, { type: 'image', mediaType: 'image/jpeg', data: 'x' }] })
  expect(requests[0].messages[0].content).toEqual([
    { type: 'text', text: 'Reference photos of the real object are attached. Plan checks for the features they show and for every size in the description.\n\nRequest: A bracket' },
    { type: 'text', text: 'Reference photo (front)' },
    { type: 'image', mediaType: 'image/jpeg', data: 'x' },
  ])
})

it('sends the plain request when there are no photos', async () => {
  const { provider, requests } = scriptedProvider(REPLY)
  await runPlan({ provider, model: 'm', request: 'A bracket', photos: [] })
  expect(requests[0].messages[0].content).toBe('Request: A bracket')
})
