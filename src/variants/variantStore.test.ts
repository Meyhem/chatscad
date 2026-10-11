import type { LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import { okResult } from '../test/results'
import { commitPick } from './commitPick'
import { runVariants } from './runVariants'
import type { VariantRequest, VariantSlot } from './types'
import { useVariantStore } from './variantStore'

vi.mock('./runVariants', () => ({ runVariants: vi.fn(async () => {}) }))
vi.mock('./commitPick', () => ({ commitPick: vi.fn(async () => ({ id: 'picked' })) }))
vi.mock('./recordUsage', () => ({ recordUsage: vi.fn() }))
vi.mock('../ai/runTurn', () => ({ runTurn: vi.fn() }))
vi.mock('../render/sharedQueue', () => ({ getRenderQueue: () => ({ render: vi.fn() }) }))

const request = {
  provider: {} as LlmProvider,
  profile: { id: 'profile-1', adapter: 'openai-compatible', baseUrl: 'https://fake-llm.test/v1' } as ProviderProfile,
  model: 'fake-model',
  history: [],
  userText: 'A hook',
  ctx: { code: '' },
  maxFixAttempts: 2,
  projectId: 'project-1',
  parentId: 'version-3',
} satisfies VariantRequest

type RunArgs = Parameters<typeof runVariants>
const lastRun = () => vi.mocked(runVariants).mock.calls.at(-1) as RunArgs

beforeEach(() => {
  vi.clearAllMocks()
  useVariantStore.getState().discard()
})

it('opens with three generating slots and starts the run', () => {
  useVariantStore.getState().start(request)
  const s = useVariantStore.getState()
  expect(s.open).toBe(true)
  expect(s.groupId).toMatch(/^[0-9a-f-]{36}$/)
  expect(s.slots.map((slot) => [slot.letter, slot.status, slot.temperature])).toEqual([
    ['A', 'generating', undefined],
    ['B', 'generating', 0.7],
    ['C', 'generating', 1.0],
  ])
  const [req, slots, opts] = lastRun()
  expect(req).toBe(request)
  expect(slots).toEqual(s.slots)
  expect(opts.signal.aborted).toBe(false)
})

it('applies slot updates and selects the first variant that renders', () => {
  useVariantStore.getState().start(request)
  const [, , opts] = lastRun()
  opts.onSlot(1, { status: 'ok', code: 'cube(2);', result: okResult(), resultCode: 'cube(2);' })
  opts.onSlot(0, { status: 'ok', code: 'cube(1);', result: okResult(), resultCode: 'cube(1);' })
  const s = useVariantStore.getState()
  expect(s.slots[1]).toMatchObject({ status: 'ok', code: 'cube(2);' })
  expect(s.selected).toBe(1)
})

it('regenerates with a new group and ignores the old run', () => {
  useVariantStore.getState().start(request)
  const [, , first] = lastRun()
  const firstGroup = useVariantStore.getState().groupId
  useVariantStore.getState().regenerate()
  expect(first.signal.aborted).toBe(true)
  expect(useVariantStore.getState().groupId).not.toBe(firstGroup)
  first.onSlot(0, { status: 'ok' })
  expect(useVariantStore.getState().slots[0].status).toBe('generating')
})

it('discards without saving anything', () => {
  useVariantStore.getState().start(request)
  const [, , opts] = lastRun()
  useVariantStore.getState().discard()
  expect(opts.signal.aborted).toBe(true)
  expect(useVariantStore.getState().open).toBe(false)
  expect(commitPick).not.toHaveBeenCalled()
})

it('picks only a rendered variant, commits it and closes', async () => {
  useVariantStore.getState().start(request)
  const [, , opts] = lastRun()
  opts.onSlot(0, { status: 'error' })
  useVariantStore.getState().select(0)
  await useVariantStore.getState().pick()
  expect(commitPick).not.toHaveBeenCalled()

  opts.onSlot(2, { status: 'ok', code: 'cube(3);', result: okResult(), resultCode: 'cube(3);' })
  useVariantStore.getState().select(2)
  const slots = useVariantStore.getState().slots
  await useVariantStore.getState().pick()
  expect(commitPick).toHaveBeenCalledWith({
    projectId: 'project-1',
    parentId: 'version-3',
    groupId: expect.any(String),
    prompt: 'A hook',
    slots,
    picked: 2,
  })
  expect(opts.signal.aborted).toBe(true)
  expect(useVariantStore.getState().open).toBe(false)
})

it('keeps the picker open with the reason when saving fails', async () => {
  vi.mocked(commitPick).mockRejectedValueOnce(new Error('No project is open'))
  useVariantStore.getState().start(request)
  const [, , opts] = lastRun()
  opts.onSlot(0, { status: 'ok', code: 'cube(1);' } satisfies Partial<VariantSlot>)
  await useVariantStore.getState().pick()
  expect(useVariantStore.getState()).toMatchObject({ open: true, picking: false, error: 'Could not save the variants: No project is open' })
})
