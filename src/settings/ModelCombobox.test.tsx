import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ModelInfo, ModelPrice } from '../ai/types'
import { formatPrice, ModelCombobox } from './ModelCombobox'

const MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', price: { inputPerMTok: 3, outputPerMTok: 15 }, capabilities: { vision: true, audio: false } },
  { id: 'example/sonnet-coder-32b' },
  { id: 'openai/gpt-x', name: 'GPT X', price: { inputPerMTok: 0.0005, outputPerMTok: 0.0015 } },
]

function Harness({ models = MODELS, priceTable = {}, onPick = () => {} }: { models?: ModelInfo[]; priceTable?: Record<string, ModelPrice>; onPick?(m: ModelInfo): void }) {
  const [value, setValue] = useState('')
  return (
    <>
      <label htmlFor="m">Default model</label>
      <ModelCombobox id="m" value={value} models={models} priceTable={priceTable} onChange={setValue} onPick={onPick} />
      <output data-testid="value">{value}</output>
    </>
  )
}

const box = () => screen.getByRole('combobox', { name: 'Default model' })
const options = () => within(screen.getByRole('listbox')).getAllByRole('option')

it('formats prices per million tokens', () => {
  expect(formatPrice({ inputPerMTok: 3, outputPerMTok: 15 })).toBe('$3.00 / $15.00')
  expect(formatPrice({ inputPerMTok: 0.0005, outputPerMTok: 0.0015 })).toBe('$0.0005 / $0.0015')
  expect(formatPrice({ inputPerMTok: 0, outputPerMTok: 0 })).toBe('$0.00 / $0.00')
})

it('filters by id and name, and shows name, id, price and capabilities', async () => {
  render(<Harness />)
  await userEvent.type(box(), 'SONNET')
  expect(options().map((o) => o.textContent)).toEqual([
    expect.stringContaining('Claude Sonnet 5.5'),
    expect.stringContaining('example/sonnet-coder-32b'),
    'Use “SONNET” as typed',
  ])
  const first = options()[0]
  expect(first).toHaveTextContent('anthropic/claude-sonnet-5-5')
  expect(first).toHaveTextContent('$3.00 / $15.00')
  expect(first).toHaveTextContent('vision')
  expect(options()[1]).toHaveTextContent('No price listed')
  expect(screen.getByText('2 of 3 models · prices per 1M input / output tokens')).toBeInTheDocument()
})

it('prefers the profile price table over the listed price', async () => {
  render(<Harness priceTable={{ 'anthropic/claude-sonnet-5-5': { inputPerMTok: 1, outputPerMTok: 2 } }} />)
  await userEvent.type(box(), 'claude')
  expect(options()[0]).toHaveTextContent('$1.00 / $2.00')
})

it('picks the highlighted option with the keyboard and closes with Escape', async () => {
  const onPick = vi.fn()
  render(<Harness onPick={onPick} />)
  await userEvent.type(box(), 'gpt')
  expect(box()).toHaveAttribute('aria-expanded', 'true')
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(onPick).toHaveBeenCalledWith(MODELS[2])
  expect(screen.getByTestId('value')).toHaveTextContent('openai/gpt-x')
  expect(box()).toHaveAttribute('aria-expanded', 'false')

  await userEvent.type(box(), 'x')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('keeps a typed name the list does not have', async () => {
  render(<Harness />)
  await userEvent.type(box(), 'my-local-model')
  fireEvent.mouseDown(screen.getByRole('option', { name: 'Use “my-local-model” as typed' }))
  expect(screen.getByTestId('value')).toHaveTextContent('my-local-model')
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('shows at most 50 matches', async () => {
  const many = Array.from({ length: 342 }, (_, i) => ({ id: `model-${i}` }))
  render(<Harness models={many} />)
  await userEvent.click(box())
  expect(options()).toHaveLength(50)
  expect(screen.getByText('50 of 342 models · prices per 1M input / output tokens')).toBeInTheDocument()
})

it('shows the id once for a model the provider gives no name', async () => {
  render(<Harness />)
  await userEvent.type(box(), 'coder')
  expect(within(options()[0]).getAllByText('example/sonnet-coder-32b')).toHaveLength(1)
})
