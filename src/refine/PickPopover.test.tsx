import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { boxPickFixture, partPickFixture } from '../test/picks'
import { NO_VISION_REGION, PickPopover } from './PickPopover'

it('shows the part, its kind and lines, its size, and the two actions', async () => {
  const onAskAi = vi.fn()
  const onShowCode = vi.fn()
  render(<PickPopover pick={partPickFixture()} vision onAskAi={onAskAi} onShowCode={onShowCode} />)
  const popover = screen.getByRole('region', { name: 'Selected part' })
  expect(popover).toHaveClass('bg-panel-raised', 'border-line', 'shadow-pop', 'rounded-lg')
  expect(popover).toHaveTextContent('bores')
  expect(popover).toHaveTextContent('for loop · lines 15–17')
  expect(screen.getByTestId('pick-summary')).toHaveTextContent('2 triangles · 10 × 10 × 0 mm')

  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  expect(onAskAi).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Show code' }))
  expect(onShowCode).toHaveBeenCalledWith(15)
})

it('a region on a profile without vision explains the text-only fallback and has no Show code', () => {
  render(<PickPopover pick={boxPickFixture()} vision={false} onAskAi={() => {}} onShowCode={() => {}} />)
  expect(screen.getByRole('region', { name: 'Selected part' })).toHaveTextContent('Selected region')
  expect(screen.getByText('Not matched to code')).toBeInTheDocument()
  expect(screen.getByRole('note')).toHaveTextContent(NO_VISION_REGION)
  expect(screen.queryByRole('button', { name: 'Show code' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Ask AI' })).toBeEnabled()
})

it('a region on a vision profile needs no callout', () => {
  render(<PickPopover pick={boxPickFixture()} vision onAskAi={() => {}} onShowCode={() => {}} />)
  expect(screen.queryByRole('note')).toBeNull()
})

it('renders labels from the code as text only', () => {
  const pick = partPickFixture()
  const evil = { ...pick, statement: { ...pick.statement, label: '<img src=x onerror=alert(1)>' } }
  const { container } = render(<PickPopover pick={evil} vision onAskAi={() => {}} onShowCode={() => {}} />)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByRole('region', { name: 'Selected part' })).toHaveTextContent('<img src=x onerror=alert(1)>')
})
