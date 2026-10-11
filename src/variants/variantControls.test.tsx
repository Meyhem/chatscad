import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePrefs } from '../settings/prefsStore'
import { initialSlots } from './types'
import { VariantCountButton } from './VariantCountButton'
import { VariantProgressPill } from './VariantProgressPill'
import { useVariantStore } from './variantStore'

beforeEach(() => usePrefs.setState(usePrefs.getInitialState(), true))

it('toggles between one reply and three variants per prompt', async () => {
  const update = vi.fn(async () => {})
  usePrefs.setState({ update })
  const { rerender } = render(<VariantCountButton />)
  const button = screen.getByRole('button', { name: 'Variants per prompt' })
  expect(button).toHaveTextContent('1')
  expect(button).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(button)
  expect(update).toHaveBeenCalledWith({ variantCount: 3 })

  usePrefs.setState({ variantCount: 3 })
  rerender(<VariantCountButton />)
  expect(button).toHaveTextContent('3')
  expect(button).toHaveAttribute('title', '3 variants per prompt')
})

it('shows variant progress in the header only while the picker works', () => {
  useVariantStore.setState({ open: false, slots: [] })
  const { container, rerender } = render(<VariantProgressPill />)
  expect(container).toBeEmptyDOMElement()
  useVariantStore.setState({ open: true, slots: initialSlots('m', [undefined, 0.7, 1]) })
  rerender(<VariantProgressPill />)
  expect(screen.getByRole('status')).toHaveTextContent('Generating 3 variants')
  expect(screen.getByRole('status')).toHaveClass('pc-status', 'is-busy')
})
