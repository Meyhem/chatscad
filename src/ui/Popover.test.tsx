import { fireEvent, render, screen } from '@testing-library/react'
import { Popover } from './Popover'

function setup() {
  render(
    <div>
      <Popover label="Review settings" trigger={(props) => <button type="button" {...props}>Review</button>}>
        <button type="button">Inside</button>
      </Popover>
      <button type="button">Outside</button>
    </div>,
  )
  return screen.getByRole('button', { name: 'Review' })
}

it('opens a labelled dialog from its button and closes on Escape, returning focus', () => {
  const trigger = setup()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const dialog = screen.getByRole('dialog', { name: 'Review settings' })
  expect(dialog).toContainElement(screen.getByRole('button', { name: 'Inside' }))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('closes on a click outside, not inside', () => {
  const trigger = setup()
  fireEvent.click(trigger)
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
