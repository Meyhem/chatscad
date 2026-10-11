import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { boxPickFixture, partPickFixture } from '../test/picks'
import { PickChip } from './PickChip'
import { useRefineStore } from './refineStore'

beforeEach(() => useRefineStore.setState(useRefineStore.getInitialState(), true))

it('renders nothing without a pick', () => {
  const { container } = render(<PickChip />)
  expect(container).toBeEmptyDOMElement()
})

it('names the part and its lines, says only it will change, and clears', async () => {
  useRefineStore.setState({ pick: partPickFixture() })
  render(<PickChip />)
  const chip = screen.getByText('bores · lines 15–17')
  expect(chip).toHaveClass('pc-chip', 'is-pick')
  expect(screen.getByText('Only this part will change')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Clear selected part' }))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('describes a region by its size', () => {
  useRefineStore.setState({ pick: boxPickFixture() })
  render(<PickChip />)
  expect(screen.getByText('Selected region · 10 × 10 × 0 mm')).toBeInTheDocument()
  expect(screen.getByText('Its position is sent with your message')).toBeInTheDocument()
})
