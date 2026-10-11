import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LlmProvider } from '../ai/types'
import type { ProviderProfile } from '../db/db'
import { errorResult, okResult } from '../test/results'
import { initialSlots, type VariantRequest, type VariantSlot } from './types'
import { VariantPicker } from './VariantPicker'
import { useVariantStore } from './variantStore'

vi.mock('./VariantPreview', () => ({
  VariantPreview: ({ label }: { label: string }) => <div data-testid="variant-preview">{label}</div>,
}))

const request: VariantRequest = {
  provider: {} as LlmProvider,
  profile: { id: 'p', adapter: 'openai-compatible', baseUrl: 'https://fake-llm.test/v1' } as ProviderProfile,
  model: 'fake-model',
  history: [],
  userText: 'A hook for a 30 mm broom handle',
  ctx: { code: '' },
  maxFixAttempts: 2,
  projectId: 'project-1',
  parentId: null,
}

function seed(overrides: Partial<VariantSlot>[], selected: number | null = null) {
  const base = initialSlots('fake-model', [undefined, 0.7, 1.0])
  const slots = base.map((s, i) => ({ ...s, ...overrides[i] }))
  const actions = { pick: vi.fn(async () => {}), discard: vi.fn(), regenerate: vi.fn() }
  useVariantStore.setState({ open: true, groupId: 'g', request, slots, selected, picking: false, error: null, ...actions })
  return actions
}

const usage = { inputTokens: 1_000, outputTokens: 500, cost: 0.002 }

it('shows three cards with preview, status, size, parameters and cost, as in the Variants screen', () => {
  seed([
    { status: 'ok', code: 'cube(1);', result: okResult(), resultCode: 'cube(1);', usage },
    { status: 'queued', renderSeq: 1, code: 'cube(2);', usage },
    { status: 'queued', renderSeq: 2, code: 'cube(3);' },
  ])
  render(<VariantPicker />)
  const dialog = screen.getByRole('dialog', { name: 'Pick a variant' })
  expect(dialog).toHaveTextContent('“A hook for a 30 mm broom handle” Sent 3 times at once to fake-model.')

  const [a, b, c] = within(dialog).getAllByRole('option')
  expect(a).toHaveClass('pc-variant')
  expect(within(a).getByTestId('variant-preview')).toHaveTextContent('Variant A')
  expect(a).toHaveTextContent('A · fake-model')
  expect(within(a).getByText('Rendered')).toHaveClass('pc-status', 'is-ok')
  expect(a).toHaveTextContent('20 × 20 × 10 mm · 0 params')
  expect(a).toHaveTextContent('$0.002')
  expect(within(b).getAllByText('Rendering…')[0].closest('.pc-status')).toHaveClass('is-busy')
  expect(within(c).getAllByText('Queued')).not.toHaveLength(0)
  expect(c).toHaveTextContent('waiting for the renderer')
  expect(c).toHaveTextContent('$0.000')
  expect(dialog.querySelectorAll('svg.pc-i').length).toBeGreaterThanOrEqual(6)
  expect(dialog).toHaveTextContent("Drag to orbit any preview. The ones you don't pick stay in history as variants.")
})

it('uses only a rendered variant and marks failed ones', async () => {
  const actions = seed([
    { status: 'error', code: 'x', result: errorResult(), resultCode: 'x' },
    { status: 'ok', code: 'cube(2);', result: okResult(), resultCode: 'cube(2);' },
    { status: 'failed-request', error: { title: 'The provider rejected the API key', body: '' } },
  ])
  render(<VariantPicker />)
  const [a, b, c] = screen.getAllByRole('option')
  expect(a).toHaveClass('is-failed')
  expect(c).toHaveClass('is-failed')
  const use = screen.getByRole('button', { name: 'Use variant' })
  expect(use).toBeDisabled()

  await userEvent.click(a)
  expect(a).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: 'Use variant A' })).toBeDisabled()

  await userEvent.click(b)
  const useB = screen.getByRole('button', { name: 'Use variant B' })
  expect(useB).toBeEnabled()
  expect(useB).toHaveClass('is-primary')
  expect(document.querySelectorAll('[role="dialog"] .pc-btn.is-primary')).toHaveLength(1)
  await userEvent.click(useB)
  expect(actions.pick).toHaveBeenCalledOnce()
})

it('selects a card from the keyboard', async () => {
  seed([{}, { status: 'ok', code: 'c', result: okResult(), resultCode: 'c' }, {}])
  render(<VariantPicker />)
  screen.getAllByRole('option')[1].focus()
  await userEvent.keyboard('{Enter}')
  expect(useVariantStore.getState().selected).toBe(1)
})

it('discards, regenerates, and treats Esc as discard', async () => {
  const actions = seed([{}, {}, {}])
  render(<VariantPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
  expect(actions.regenerate).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Discard all' }))
  await userEvent.keyboard('{Escape}')
  expect(actions.discard).toHaveBeenCalledTimes(2)
})

it('shows why saving failed', () => {
  seed([{}, {}, {}])
  useVariantStore.setState({ error: 'Could not save the variants: No project is open' })
  render(<VariantPicker />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save the variants: No project is open')
})

it('ignores Esc once a variant has code, so a stray key never throws away paid replies', async () => {
  const actions = seed([{ status: 'ok', code: 'cube(1);' }, {}, {}])
  render(<VariantPicker />)
  await userEvent.keyboard('{Escape}')
  expect(actions.discard).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Discard all' })).toBeInTheDocument()
})
