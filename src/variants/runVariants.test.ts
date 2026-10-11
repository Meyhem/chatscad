import type { runTurn } from '../ai/runTurn'
import { ProviderError, type LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import type { RenderRequest } from '../render/types'
import { errorResult, okResult } from '../test/results'
import { runVariants, type RunVariantsDeps } from './runVariants'
import { initialSlots, type VariantRequest, type VariantSlot } from './types'

type TurnOpts = Parameters<typeof runTurn>[0]

const profile: ProviderProfile = {
  id: 'profile-1',
  name: 'Fake',
  adapter: 'openai-compatible',
  baseUrl: 'https://fake-llm.test/v1',
  apiKey: 'test-key',
  defaultModel: 'fake-model',
  cachedModels: [],
  capabilities: { streaming: true, vision: false, audio: false },
  priceTable: { 'fake-model': { inputPerMTok: 1, outputPerMTok: 2 } },
  createdAt: 0,
  updatedAt: 0,
}
const provider: LlmProvider = { listModels: async () => [], async *streamChat() {} }
const request: VariantRequest = {
  provider,
  profile,
  model: 'fake-model',
  history: [{ role: 'user', content: 'earlier' }],
  userText: 'A hook for a 30 mm broom handle',
  ctx: { code: 'cube(1);' },
  maxFixAttempts: 2,
  projectId: 'project-1',
  parentId: 'version-3',
}

function harness(scripts: Array<(o: TurnOpts) => Promise<void>>) {
  const slots: VariantSlot[] = initialSlots('fake-model', [undefined, 0.7, 1.0])
  const onSlot = (i: number, patch: Partial<VariantSlot>) => {
    slots[i] = { ...slots[i], ...patch }
  }
  let call = 0
  const turns = vi.fn(async (o: TurnOpts) => scripts[call++](o))
  const queue = { render: vi.fn(async (req: RenderRequest) => (req.code.includes('broken') ? errorResult() : okResult())) }
  const recordUsage = vi.fn(async () => {})
  const deps = { queue, runTurn: turns, recordUsage } as unknown as RunVariantsDeps
  return { slots, onSlot, turns, queue, recordUsage, deps }
}

const reply = (o: TurnOpts, code: string | null, attempt = 0) =>
  o.onEvent({ type: 'reply', result: { code, prose: 'Made it.', usage: { inputTokens: 1_000, outputTokens: 500 }, model: o.model }, attempt })

const success = (code: string) => async (o: TurnOpts) => {
  reply(o, code)
  o.apply(code, 'ai')
  o.onEvent({ type: 'rendered', result: await o.render(code, o.signal), attempt: 0 })
}

it('asks three times in parallel with the same model and request, and renders in the background queue', async () => {
  const h = harness([success('cube(10);'), success('cube(20);'), success('cube(30);')])
  const controller = new AbortController()
  await runVariants(request, h.slots, { signal: controller.signal, onSlot: h.onSlot }, h.deps)

  expect(h.turns).toHaveBeenCalledTimes(3)
  for (const [opts] of h.turns.mock.calls) {
    expect(opts).toMatchObject({ model: 'fake-model', history: request.history, ctx: request.ctx, maxFixAttempts: 2 })
    expect(opts.userText).toContain(request.userText)
    expect(opts.signal).toBe(controller.signal)
  }
  expect(h.turns.mock.calls[0][0].provider).toBe(provider)
  expect(h.turns.mock.calls[1][0].provider).not.toBe(provider)
  expect(h.queue.render.mock.calls.map(([req]) => req)).toEqual([{ code: 'cube(10);' }, { code: 'cube(20);' }, { code: 'cube(30);' }])
  expect(h.slots.map((s) => [s.status, s.code, s.resultCode, s.renderSeq])).toEqual([
    ['ok', 'cube(10);', 'cube(10);', null],
    ['ok', 'cube(20);', 'cube(20);', null],
    ['ok', 'cube(30);', 'cube(30);', null],
  ])
})

it('records usage for every reply, including auto-fix replies, and sums it per slot', async () => {
  const fixThenSucceed = async (o: TurnOpts) => {
    reply(o, 'broken(')
    o.apply('broken(', 'ai')
    const failed = await o.render('broken(', o.signal)
    o.onEvent({ type: 'rendered', result: failed, attempt: 0 })
    o.onEvent({ type: 'fixing', attempt: 1, of: 2, errors: 'syntax error' })
    reply(o, 'cube(1);', 1)
    o.apply('cube(1);', 'autofix')
    o.onEvent({ type: 'rendered', result: await o.render('cube(1);', o.signal), attempt: 1 })
  }
  const h = harness([fixThenSucceed, success('cube(2);'), success('cube(3);')])
  await runVariants(request, h.slots, { signal: new AbortController().signal, onSlot: h.onSlot }, h.deps)

  expect(h.recordUsage).toHaveBeenCalledTimes(4)
  expect(h.recordUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId: 'profile-1',
      model: 'fake-model',
      inputTokens: 1_000,
      outputTokens: 500,
      costSource: 'price-table',
      projectId: 'project-1',
      versionId: null,
    }),
  )
  expect(h.slots[0]).toMatchObject({ status: 'ok', code: 'cube(1);', fixAttempt: 1, usage: { inputTokens: 2_000, outputTokens: 1_000 } })
  expect(h.slots[0].usage.cost).toBeCloseTo(0.004)
})

it('marks a reply without code, a failed request and a cancelled turn', async () => {
  const noCode = async (o: TurnOpts) => reply(o, null)
  const rejected = async () => {
    throw new ProviderError('auth', 'Invalid API key', 401)
  }
  const waitsForever = (o: TurnOpts) =>
    new Promise<void>((_, reject) => o.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
  const h = harness([noCode, rejected, waitsForever])
  const controller = new AbortController()
  const run = runVariants(request, h.slots, { signal: controller.signal, onSlot: h.onSlot }, h.deps)
  await new Promise((resolve) => setTimeout(resolve, 0))
  controller.abort()
  await run

  expect(h.slots.map((s) => s.status)).toEqual(['no-code', 'failed-request', 'cancelled'])
  expect(h.slots[1].error?.title).toBeTruthy()
  expect(h.slots[0].code).toBeNull()
})

it('numbers renders in the order they entered the queue', async () => {
  const h = harness([success('cube(1);'), success('cube(2);'), success('cube(3);')])
  const seqs: Array<number | null | undefined> = []
  await runVariants(
    request,
    h.slots,
    {
      signal: new AbortController().signal,
      onSlot: (i, patch) => {
        if (patch.status === 'queued') seqs.push(patch.renderSeq)
        h.onSlot(i, patch)
      },
    },
    h.deps,
  )
  expect(seqs).toEqual([1, 2, 3])
})

it('asks B and C for a different approach and the simplest printable design, so variants differ even where temperature is ignored', async () => {
  const h = harness([async () => {}, async () => {}, async () => {}])
  await runVariants(request, h.slots, { signal: new AbortController().signal, onSlot: h.onSlot }, h.deps)
  const asked = h.turns.mock.calls.map(([o]) => o.userText as string)
  expect(asked[0]).toBe('A hook for a 30 mm broom handle')
  expect(asked[1]).toMatch(/^A hook for a 30 mm broom handle\n\n.*different approach/)
  expect(asked[2]).toMatch(/^A hook for a 30 mm broom handle\n\n.*simplest/)
  expect(new Set(asked).size).toBe(3)
})

it('renders each variant with the project libraries the model was told about', async () => {
  const h = harness([success('cube(10);'), success('cube(20);'), success('cube(30);')])
  await runVariants({ ...request, ctx: { code: 'cube(1);', libraries: ['BOSL2'] } }, h.slots, { signal: new AbortController().signal, onSlot: h.onSlot }, h.deps)
  expect(h.queue.render.mock.calls.map(([req]) => req)).toEqual([
    { code: 'cube(10);', libraries: ['BOSL2'] },
    { code: 'cube(20);', libraries: ['BOSL2'] },
    { code: 'cube(30);', libraries: ['BOSL2'] },
  ])
})
