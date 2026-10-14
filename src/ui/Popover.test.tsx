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

describe('stays inside the window', () => {
  const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 100, height: 100, x: left, y: 0, toJSON: () => ({}) })
  afterEach(() => vi.restoreAllMocks())

  function openAt(left: number, width: number) {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.getAttribute('role') === 'dialog' ? rect(left, width) : rect(0, 0)) as DOMRect
    })
    fireEvent.click(setup())
    return screen.getByRole('dialog')
  }

  it('shifts right when it would run past the left edge', () => {
    expect(openAt(-80, 360).style.transform).toBe('translateX(92px)')
  })

  it('shifts left when it would run past the right edge', () => {
    expect(openAt(600, 360).style.transform).toBe('translateX(-172px)')
  })

  it('stays put when it fits', () => {
    expect(openAt(100, 360).style.transform).toBe('')
  })
})
